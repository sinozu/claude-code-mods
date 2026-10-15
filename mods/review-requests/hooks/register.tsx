import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bucket, Checks, ReviewPr } from '../types'

const PANE = 'review-requests'
const REFRESH_MS = 5 * 60_000
const LIMIT = 30
const SEARCH_FIELDS = 'number,title,repository,url,author,updatedAt,isDraft'
const VIEW_FIELDS = 'additions,deletions,reviewDecision,latestReviews,statusCheckRollup'

const prs = atom({ plugin: 'review-requests', key: 'prs' } as const, [])
const isOpen = atom({ plugin: 'review-requests', key: 'isOpen' } as const, false)
const fetchedAt = atom({ plugin: 'review-requests', key: 'fetchedAt' } as const, 0)
const lastError = atom({ plugin: 'review-requests', key: 'error' } as const, null)

type Found = {
  number: number
  title: string
  url: string
  isDraft: boolean
  updatedAt: string
  author: { login: string }
  repository: { nameWithOwner: string }
}

type Rollup =
  | { __typename: 'CheckRun'; name: string; status: string; conclusion: string | null }
  | { __typename: 'StatusContext'; context: string; state: string }

type View = {
  additions: number
  deletions: number
  reviewDecision: string
  latestReviews: { author: { login: string }; state: string }[]
  statusCheckRollup: Rollup[]
}

let login = ''

const fetchLogin = async ($: EngineInterface) => {
  try {
    const ran = await $.process.run(['gh', 'api', 'user', '--jq', '.login'], { timeoutMs: 20_000 })
    if (ran.exitCode === 0) login = ran.stdout.trim()
  } catch {
    login = ''
  }
}

// Approved by you, or approved overall: nothing left to review.
const isApproved = (view: View) =>
  view.reviewDecision === 'APPROVED' ||
  (login !== '' && (view.latestReviews ?? []).some(review => review.author.login === login && review.state === 'APPROVED'))

type Color = 'success' | 'error' | 'warning' | 'subtle' | 'text' | 'claude'

const BUCKET: Record<Bucket, { glyph: string; color: Color; label: string }> = {
  pass: { glyph: '✓', color: 'success', label: 'passed' },
  fail: { glyph: '✗', color: 'error', label: 'failed' },
  pending: { glyph: '◌', color: 'warning', label: 'running' },
  skipped: { glyph: '↷', color: 'subtle', label: 'skipped' },
}

const bucketOf = (item: Rollup): Bucket => {
  if (item.__typename === 'StatusContext') {
    if (item.state === 'SUCCESS') return 'pass'
    if (item.state === 'PENDING' || item.state === 'EXPECTED') return 'pending'
    return 'fail'
  }
  if (item.status !== 'COMPLETED') return 'pending'
  if (item.conclusion === 'SUCCESS' || item.conclusion === 'NEUTRAL') return 'pass'
  if (item.conclusion === 'SKIPPED') return 'skipped'
  return 'fail'
}

const nameOf = (item: Rollup) => (item.__typename === 'StatusContext' ? item.context : item.name)

const zero = (): Checks => ({ pass: 0, fail: 0, pending: 0, skipped: 0 })

const withDetails = async ($: EngineInterface, pr: ReviewPr): Promise<ReviewPr | null> => {
  try {
    const ran = await $.process.run(['gh', 'pr', 'view', pr.url, '--json', VIEW_FIELDS], { timeoutMs: 20_000 })
    if (ran.exitCode !== 0) return { ...pr, error: ran.stderr.trim().split('\n')[0] || `gh exited ${ran.exitCode}` }
    const view = JSON.parse(ran.stdout) as View
    if (isApproved(view)) return null
    const checks = zero()
    const failed: string[] = []
    for (const item of view.statusCheckRollup ?? []) {
      const bucket = bucketOf(item)
      checks[bucket] += 1
      if (bucket === 'fail') failed.push(nameOf(item))
    }
    return {
      ...pr,
      additions: view.additions ?? 0,
      deletions: view.deletions ?? 0,
      reviewDecision: view.reviewDecision ?? '',
      checks,
      failed,
      error: null,
    }
  } catch (error) {
    return { ...pr, error: error instanceof Error ? error.message : String(error) }
  }
}

const refresh = async ($: EngineInterface) => {
  try {
    const ran = await $.process.run(
      ['gh', 'search', 'prs', '--review-requested=@me', '--state=open', `--limit=${LIMIT}`, '--json', SEARCH_FIELDS],
      { timeoutMs: 30_000 },
    )
    if (ran.exitCode !== 0) {
      await update($, lastError, () => ran.stderr.trim().split('\n')[0] || `gh exited ${ran.exitCode}`)
      return
    }
    const found = JSON.parse(ran.stdout) as Found[]
    const previous = await read($, prs)
    const base: ReviewPr[] = found.map(one => {
      const known = previous.find(pr => pr.url === one.url)
      return {
        url: one.url,
        repo: one.repository.nameWithOwner,
        number: one.number,
        title: one.title,
        author: one.author.login,
        isDraft: one.isDraft,
        updatedAt: one.updatedAt,
        additions: known?.additions ?? 0,
        deletions: known?.deletions ?? 0,
        reviewDecision: known?.reviewDecision ?? '',
        checks: known?.checks ?? zero(),
        failed: known?.failed ?? [],
        error: null,
      }
    })
    if (login === '') await fetchLogin($)
    const detailed = (await Promise.all(base.map(pr => withDetails($, pr)))).filter((pr): pr is ReviewPr => pr !== null)
    detailed.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    await update($, prs, () => detailed)
    await update($, lastError, () => null)
    const now = await $.clock.now()
    await update($, fetchedAt, () => now)
  } catch (error) {
    await update($, lastError, () => (error instanceof Error ? error.message : String(error)))
  }
}

const storeKey = async ($: EngineInterface) => `open:${await $.session.id()}`

const openPane = async ($: EngineInterface) => {
  await update($, isOpen, () => true)
  await $.ui.open({ id: PANE, title: 'Reviews' })
  await $.store.set(await storeKey($), true)
}

const closePane = async ($: EngineInterface) => {
  await update($, isOpen, () => false)
  await $.ui.close({ id: PANE })
  await $.store.set(await storeKey($), false)
}

const toneOf = (pr: ReviewPr): { glyph: string; color: Color } => {
  if (pr.error !== null) return { glyph: '!', color: 'warning' }
  if (pr.checks.fail > 0) return BUCKET.fail
  if (pr.checks.pending > 0) return BUCKET.pending
  if (pr.checks.pass > 0) return BUCKET.pass
  return { glyph: '·', color: 'subtle' }
}

const reviewOf = (decision: string): { label: string; color: Color } =>
  decision === 'CHANGES_REQUESTED' ? { label: 'changes requested', color: 'error' } : { label: 'waiting for review', color: 'warning' }

const ageOf = (now: number, iso: string) => {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const minutes = Math.max(0, Math.round((now - then) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

const sinceOf = (now: number, then: number) => {
  if (then === 0) return 'fetching'
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'reviews',
      description: 'Open or close the panel of PRs waiting for your review',
    })
    $.clock.every(REFRESH_MS, () => void refresh($))
    void fetchLogin($).then(() => refresh($))
    if ((await $.store.get(await storeKey($))) === true) {
      await update($, isOpen, () => true)
      void $.ui.open({ id: PANE, title: 'Reviews' })
    }

    return next(e)
  })

  on('command.run', { command: 'reviews' }, async $ => {
    if (await read($, isOpen)) {
      await closePane($)
      return { text: 'Review panel closed.' }
    }
    await openPane($)
    void refresh($)
    const list = await read($, prs)

    return { text: `Review panel opened. ${list.length} PR(s) waiting for your review.` }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') {
      await update($, isOpen, () => false)
      await $.store.set(await storeKey($), false)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, prs)
    const open = await read($, isOpen)
    const error = await read($, lastError)
    const failing = list.filter(pr => pr.checks.fail > 0).length
    const tone: Color = error !== null ? 'warning' : failing > 0 ? 'error' : list.length > 0 ? 'claude' : 'subtle'
    const below = await next(e)
    const rest = below.type === 'engine' ? null : below

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color={tone} bold>▌</Text>
          <Text bold>Reviews</Text>
          <Text inverse color={tone}> {list.length} </Text>
          <Text dimColor>│</Text>
          {failing > 0 && <Text color="error">✗ {failing} with failing CI</Text>}
          {failing === 0 && list.length > 0 && <Text color="success">CI green on all</Text>}
          {list.length === 0 && error === null && <Text dimColor>nothing waiting</Text>}
          {error !== null && <Text color="warning" wrap="truncate">gh: {error}</Text>}
          <Text dimColor>│</Text>
          <Button key="toggle" hotkey="v" label={open ? 'Panel ●' : 'Panel ○'} onPress={() => (open ? closePane($) : openPane($))} />
        </Box>
        {rest}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const list = await read($, prs)
    const error = await read($, lastError)
    const at = await read($, fetchedAt)
    const now = await $.clock.now()
    const width = Math.max(30, e.props.bodyColumns)
    const inner = width - 4

    return (
      <Box flexDirection="column" width={width}>
        <Box justifyContent="space-between" paddingX={1}>
          <Box gap={1}>
            <Text color="claude" bold>▌</Text>
            <Text bold>Waiting for your review</Text>
            <Text dimColor>({list.length})</Text>
          </Box>
          <Box gap={1}>
            <Button key="refresh" hotkey="r" label="Refresh" onPress={() => refresh($)} />
            <Button key="close" hotkey="q" label="Close" onPress={() => closePane($)} />
          </Box>
        </Box>
        <Box paddingX={1} marginBottom={1}>
          <Text dimColor>review-requested:@me · open · not yet approved · auto-refresh every {REFRESH_MS / 60_000}m, last {sinceOf(now, at)}</Text>
        </Box>
        {error !== null && (
          <Box paddingX={1}>
            <Text color="warning" wrap="truncate">gh: {error}</Text>
          </Box>
        )}
        {list.length === 0 && error === null && (
          <Box paddingX={1}>
            <Text dimColor>No open PR is waiting for your review.</Text>
          </Box>
        )}
        {list.map(pr => {
          const tone = toneOf(pr)
          const review = reviewOf(pr.reviewDecision)
          return (
            <Box key={pr.url} flexDirection="column" borderStyle="round" borderColor={tone.color} paddingX={1} width={width}>
              <Box justifyContent="space-between">
                <Box gap={1}>
                  <Text color={tone.color} bold>{tone.glyph}</Text>
                  <Text dimColor>{pr.repo}</Text>
                  <Text bold>#{pr.number}</Text>
                  {pr.isDraft && <Text inverse color="subtle"> DRAFT </Text>}
                </Box>
                <Box gap={1}>
                  <Text color="diffAdded">+{pr.additions}</Text>
                  <Text color="diffRemoved">−{pr.deletions}</Text>
                </Box>
              </Box>
              <Text bold wrap="truncate">{pr.title}</Text>
              <Box justifyContent="space-between">
                <Box gap={1}>
                  <Text color="suggestion">@{pr.author}</Text>
                  <Text dimColor>·</Text>
                  <Text color={review.color}>{review.label}</Text>
                </Box>
                <Text dimColor>updated {ageOf(now, pr.updatedAt)} ago</Text>
              </Box>
              <Text dimColor>{'─'.repeat(inner)}</Text>
              <Box gap={2}>
                {(Object.keys(BUCKET) as Bucket[]).map(bucket => (
                  <Text key={bucket} color={pr.checks[bucket] > 0 ? BUCKET[bucket].color : 'subtle'}>
                    {BUCKET[bucket].glyph} {pr.checks[bucket]}
                  </Text>
                ))}
                {pr.failed.length > 0 && <Text color="error" wrap="truncate">{pr.failed.join(', ')}</Text>}
              </Box>
              {pr.error !== null && <Text color="warning" wrap="truncate">gh: {pr.error}</Text>}
              <Link href={pr.url} label={pr.url.replace('https://github.com/', '')} />
            </Box>
          )
        })}
      </Box>
    )
  })
}
