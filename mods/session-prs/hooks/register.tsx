import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bucket, CheckRun, Checks, Pr } from '../types'

const PANE = 'session-prs'
const REFRESH_MS = 60_000
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g
const CREATES_PR = /\bgh\s+pr\s+create\b/
const FIELDS = 'number,title,state,isDraft,headRefName,baseRefName,additions,deletions,reviewDecision,mergeStateStatus,statusCheckRollup'

const prs = atom({ plugin: 'session-prs', key: 'prs' } as const, [])
const isOpen = atom({ plugin: 'session-prs', key: 'isOpen' } as const, false)

type Rollup =
  | { __typename: 'CheckRun'; name: string; status: string; conclusion: string | null }
  | { __typename: 'StatusContext'; context: string; state: string }

type View = {
  number: number
  title: string
  state: string
  isDraft: boolean
  headRefName: string
  baseRefName: string
  additions: number
  deletions: number
  reviewDecision: string
  mergeStateStatus: string
  statusCheckRollup: Rollup[]
}

type Color = 'success' | 'error' | 'warning' | 'subtle' | 'merged' | 'text'

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

const emptyPr = (url: string): Pr => ({
  url,
  number: Number(url.split('/').pop()),
  title: '',
  state: 'UNKNOWN',
  isDraft: false,
  headRefName: '',
  baseRefName: '',
  additions: 0,
  deletions: 0,
  reviewDecision: '',
  mergeStateStatus: '',
  checks: zero(),
  runs: [],
  updatedAt: 0,
  error: null,
})

const fetchPr = async ($: EngineInterface, pr: Pr): Promise<Pr> => {
  const updatedAt = await $.clock.now()
  try {
    const ran = await $.process.run(['gh', 'pr', 'view', pr.url, '--json', FIELDS], { timeoutMs: 20_000 })
    if (ran.exitCode !== 0) {
      return { ...pr, updatedAt, error: ran.stderr.trim().split('\n')[0] || `gh exited ${ran.exitCode}` }
    }
    const view = JSON.parse(ran.stdout) as View
    const checks = zero()
    const runs: CheckRun[] = []
    for (const item of view.statusCheckRollup ?? []) {
      const bucket = bucketOf(item)
      checks[bucket] += 1
      runs.push({ name: nameOf(item), bucket })
    }
    const state = view.state === 'OPEN' || view.state === 'MERGED' || view.state === 'CLOSED' ? view.state : 'UNKNOWN'
    return {
      ...pr,
      number: view.number,
      title: view.title,
      state,
      isDraft: view.isDraft,
      headRefName: view.headRefName ?? '',
      baseRefName: view.baseRefName ?? '',
      additions: view.additions ?? 0,
      deletions: view.deletions ?? 0,
      reviewDecision: view.reviewDecision ?? '',
      mergeStateStatus: view.mergeStateStatus ?? '',
      checks,
      runs,
      updatedAt,
      error: null,
    }
  } catch (error) {
    return { ...pr, updatedAt, error: error instanceof Error ? error.message : String(error) }
  }
}

const refreshAll = async ($: EngineInterface) => {
  const list = await read($, prs)
  if (list.length === 0) return
  const fresh = await Promise.all(list.map(pr => fetchPr($, pr)))
  await update($, prs, current => current.map(pr => fresh.find(one => one.url === pr.url) ?? pr))
  await persist($)
}

const addPrs = async ($: EngineInterface, urls: string[]) => {
  const added: Pr[] = []
  await update($, prs, current => {
    const known = new Set(current.map(pr => pr.url))
    for (const url of urls) {
      if (!known.has(url)) {
        known.add(url)
        added.push(emptyPr(url))
      }
    }
    return [...current, ...added]
  })
  if (added.length > 0) await refreshAll($)
}

const openPane = async ($: EngineInterface) => {
  await update($, isOpen, () => true)
  await $.ui.open({ id: PANE, title: 'PRs' })
  await persist($)
}

const closePane = async ($: EngineInterface) => {
  await update($, isOpen, () => false)
  await $.ui.close({ id: PANE })
  await persist($)
}

// The session state is lost when the process relaunches (`/tui`), so the
// list and the panel state are also kept in the store under the session id.
const storeKey = async ($: EngineInterface, name: 'prs' | 'open') => `${name}:${await $.session.id()}`

const persist = async ($: EngineInterface) => {
  await $.store.set(await storeKey($, 'prs'), await read($, prs))
  await $.store.set(await storeKey($, 'open'), await read($, isOpen))
}

const restore = async ($: EngineInterface) => {
  const saved = await $.store.get(await storeKey($, 'prs'))
  if (Array.isArray(saved) && saved.length > 0 && (await read($, prs)).length === 0) {
    await update($, prs, () => saved as Pr[])
  }
  const open = await $.store.get(await storeKey($, 'open'))
  if (open === true) await update($, isOpen, () => true)
}

const totalOf = (list: Pr[]): Checks =>
  list.reduce((sum, pr) => {
    for (const bucket of Object.keys(sum) as Bucket[]) sum[bucket] += pr.checks[bucket]
    return sum
  }, zero())

const toneOf = (pr: Pr): { glyph: string; color: Color } => {
  if (pr.error !== null) return { glyph: '!', color: 'warning' }
  if (pr.checks.fail > 0) return BUCKET.fail
  if (pr.checks.pending > 0) return BUCKET.pending
  if (pr.checks.pass > 0) return BUCKET.pass
  return { glyph: '·', color: 'subtle' }
}

const stateColor = (state: Pr['state']): Color =>
  state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'error' : state === 'OPEN' ? 'success' : 'subtle'

const reviewOf = (decision: string): { label: string; color: Color } => {
  if (decision === 'APPROVED') return { label: 'approved', color: 'success' }
  if (decision === 'CHANGES_REQUESTED') return { label: 'changes requested', color: 'error' }
  if (decision === 'REVIEW_REQUIRED') return { label: 'review required', color: 'warning' }
  return { label: 'no review', color: 'subtle' }
}

const mergeOf = (status: string): { label: string; color: Color } => {
  if (status === 'CLEAN') return { label: 'mergeable', color: 'success' }
  if (status === 'BLOCKED') return { label: 'blocked', color: 'warning' }
  if (status === 'DIRTY') return { label: 'conflicts', color: 'error' }
  if (status === 'UNSTABLE') return { label: 'checks failing', color: 'error' }
  if (status === 'BEHIND') return { label: 'behind base', color: 'warning' }
  if (status === 'DRAFT') return { label: 'draft', color: 'subtle' }
  return { label: status.toLowerCase() || 'unknown', color: 'subtle' }
}

const ageOf = (now: number, then: number) => {
  if (then === 0) return 'fetching'
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
}

// Splits `cells` cells across the buckets in proportion to their counts.
const barOf = (checks: Checks, cells: number): { bucket: Bucket; cells: number }[] => {
  const total = Object.values(checks).reduce((sum, count) => sum + count, 0)
  if (total === 0) return []
  const order: Bucket[] = ['pass', 'fail', 'pending', 'skipped']
  let used = 0
  return order
    .map((bucket, index) => {
      const share = index === order.length - 1 ? cells - used : Math.round((checks[bucket] / total) * cells)
      const width = checks[bucket] === 0 ? 0 : Math.max(1, Math.min(share, cells - used))
      used += width
      return { bucket, cells: width }
    })
    .filter(segment => segment.cells > 0)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prs',
      description: 'Open or close the panel of PRs created in this session',
    })
    $.clock.every(REFRESH_MS, () => void refreshAll($))
    await restore($)
    if (await read($, isOpen)) void $.ui.open({ id: PANE, title: 'PRs' })

    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    const open = await read($, isOpen)
    if (open) {
      await closePane($)
      return { text: 'PR panel closed.' }
    }
    await openPane($)
    void refreshAll($)
    const list = await read($, prs)

    return { text: list.length === 0 ? 'PR panel opened. No PR has been created in this session yet.' : `PR panel opened. ${list.length} PR(s).` }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') {
      await update($, isOpen, () => false)
      await persist($)
    }

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!CREATES_PR.test(e.command) || ran.deny !== undefined) return ran
    const urls = [...new Set(ran.text?.match(PR_URL) ?? [])]
    if (urls.length > 0) void addPrs($, urls)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, prs)
    const open = await read($, isOpen)
    const total = totalOf(list)
    const worst = list.find(pr => pr.checks.fail > 0) ?? list.find(pr => pr.checks.pending > 0) ?? list[0]
    const tone = worst ? toneOf(worst) : { glyph: '·', color: 'subtle' as Color }
    const below = await next(e)
    const rest = below.type === 'engine' ? null : below

    return (
      <Box flexDirection="column">
      <Box gap={1}>
        <Text color={tone.color} bold>▌</Text>
        <Text bold>PRs</Text>
        <Text inverse color={tone.color}> {list.length} </Text>
        <Text dimColor>│</Text>
        <Text color="success">✓ {total.pass}</Text>
        <Text color={total.fail > 0 ? 'error' : 'subtle'}>✗ {total.fail}</Text>
        <Text color={total.pending > 0 ? 'warning' : 'subtle'}>◌ {total.pending}</Text>
        <Text dimColor>│</Text>
        <Button key="toggle" hotkey="p" label={open ? 'Panel ●' : 'Panel ○'} onPress={() => (open ? closePane($) : openPane($))} />
        {e.viewport?.isFullscreen === false && <Text dimColor>/tui fullscreen enables clicks, or /prs</Text>}
      </Box>
      {rest}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const list = await read($, prs)
    const now = await $.clock.now()
    const total = totalOf(list)
    const width = Math.max(30, e.props.bodyColumns)
    const inner = width - 4
    const byState = { open: 0, merged: 0, closed: 0 }
    for (const pr of list) {
      if (pr.state === 'OPEN') byState.open += 1
      else if (pr.state === 'MERGED') byState.merged += 1
      else if (pr.state === 'CLOSED') byState.closed += 1
    }

    return (
      <Box flexDirection="column" width={width}>
        <Box justifyContent="space-between" paddingX={1}>
          <Box gap={1}>
            <Text color="claude" bold>▌</Text>
            <Text bold>PRs in this session</Text>
          </Box>
          <Box gap={1}>
            <Button key="refresh" hotkey="r" label="Refresh" onPress={() => refreshAll($)} />
            <Button key="close" hotkey="q" label="Close" onPress={() => closePane($)} />
          </Box>
        </Box>
        <Box paddingX={1} gap={1}>
          <Text color="success">{byState.open} open</Text>
          <Text dimColor>·</Text>
          <Text color="merged">{byState.merged} merged</Text>
          <Text dimColor>·</Text>
          <Text color={byState.closed > 0 ? 'error' : 'subtle'}>{byState.closed} closed</Text>
        </Box>
        {list.length > 0 && (
          <Box flexDirection="column" paddingX={1} marginBottom={1}>
            <Box>
              {barOf(total, inner).map(segment => (
                <Text key={segment.bucket} color={BUCKET[segment.bucket].color}>{'█'.repeat(segment.cells)}</Text>
              ))}
              {barOf(total, inner).length === 0 && <Text dimColor>{'░'.repeat(inner)}</Text>}
            </Box>
            <Box gap={2}>
              {(Object.keys(BUCKET) as Bucket[]).map(bucket => (
                <Text key={bucket} color={total[bucket] > 0 ? BUCKET[bucket].color : 'subtle'}>
                  {BUCKET[bucket].glyph} {total[bucket]} {BUCKET[bucket].label}
                </Text>
              ))}
            </Box>
          </Box>
        )}
        {list.length === 0 && (
          <Box paddingX={1} marginTop={1}>
            <Text dimColor>No PR yet. The next `gh pr create` in this session shows up here.</Text>
          </Box>
        )}
        {list.map(pr => {
          const tone = toneOf(pr)
          const review = reviewOf(pr.reviewDecision)
          const merge = mergeOf(pr.mergeStateStatus)
          const shown = pr.runs.slice(0, 8)
          return (
            <Box key={pr.url} flexDirection="column" borderStyle="round" borderColor={tone.color} paddingX={1} width={width}>
              <Box justifyContent="space-between">
                <Box gap={1}>
                  <Text color={tone.color} bold>{tone.glyph}</Text>
                  <Text bold>#{pr.number}</Text>
                  <Text inverse color={stateColor(pr.state)}> {pr.state} </Text>
                  {pr.isDraft && <Text inverse color="subtle"> DRAFT </Text>}
                </Box>
                <Box gap={1}>
                  <Text color="diffAdded">+{pr.additions}</Text>
                  <Text color="diffRemoved">−{pr.deletions}</Text>
                </Box>
              </Box>
              <Text bold wrap="truncate">{pr.title || pr.url}</Text>
              {pr.headRefName !== '' && (
                <Box gap={1}>
                  <Text dimColor>⎇</Text>
                  <Text color="suggestion" wrap="truncate">{pr.headRefName}</Text>
                  <Text dimColor>→ {pr.baseRefName}</Text>
                </Box>
              )}
              <Text dimColor>{'─'.repeat(inner)}</Text>
              {shown.length === 0 && pr.error === null && <Text dimColor>no checks on this PR</Text>}
              {shown.length > 0 && (
                <Box flexWrap="wrap" columnGap={2}>
                  {shown.map(run => (
                    <Text key={run.name} color={BUCKET[run.bucket].color} wrap="truncate">
                      {BUCKET[run.bucket].glyph} {run.name}
                    </Text>
                  ))}
                  {pr.runs.length > shown.length && <Text dimColor>+{pr.runs.length - shown.length} more</Text>}
                </Box>
              )}
              {pr.error !== null && <Text color="warning" wrap="truncate">gh: {pr.error}</Text>}
              <Box justifyContent="space-between">
                <Box gap={1}>
                  <Text color={review.color}>{review.label}</Text>
                  <Text dimColor>·</Text>
                  <Text color={merge.color}>{merge.label}</Text>
                </Box>
                <Text dimColor>{ageOf(now, pr.updatedAt)}</Text>
              </Box>
              <Link href={pr.url} label={pr.url.replace('https://github.com/', '')} />
            </Box>
          )
        })}
      </Box>
    )
  })
}
