import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Checks, Pr } from '../types'

const REFRESH_MS = 60_000
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g
const CREATES_PR = /\bgh\s+pr\s+create\b/

const prs = atom({ plugin: 'session-prs', key: 'prs' } as const, [])
const isHidden = atom({ plugin: 'session-prs', key: 'isHidden' } as const, false)

type Rollup =
  | { __typename: 'CheckRun'; name: string; status: string; conclusion: string | null }
  | { __typename: 'StatusContext'; context: string; state: string }

type View = {
  number: number
  title: string
  state: string
  isDraft: boolean
  statusCheckRollup: Rollup[]
}

const bucketOf = (item: Rollup): keyof Checks => {
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

const emptyPr = (url: string): Pr => ({
  url,
  number: Number(url.split('/').pop()),
  title: '',
  state: 'UNKNOWN',
  isDraft: false,
  checks: { pass: 0, fail: 0, pending: 0, skipped: 0 },
  failed: [],
  updatedAt: 0,
  error: null,
})

const fetchPr = async ($: EngineInterface, pr: Pr): Promise<Pr> => {
  const updatedAt = await $.clock.now()
  try {
    const ran = await $.process.run(
      ['gh', 'pr', 'view', pr.url, '--json', 'number,title,state,isDraft,statusCheckRollup'],
      { timeoutMs: 20_000 },
    )
    if (ran.exitCode !== 0) {
      return { ...pr, updatedAt, error: ran.stderr.trim().split('\n')[0] || `gh exited ${ran.exitCode}` }
    }
    const view = JSON.parse(ran.stdout) as View
    const checks: Checks = { pass: 0, fail: 0, pending: 0, skipped: 0 }
    const failed: string[] = []
    for (const item of view.statusCheckRollup ?? []) {
      const bucket = bucketOf(item)
      checks[bucket] += 1
      if (bucket === 'fail') failed.push(nameOf(item))
    }
    const state = view.state === 'OPEN' || view.state === 'MERGED' || view.state === 'CLOSED' ? view.state : 'UNKNOWN'
    return { ...pr, number: view.number, title: view.title, state, isDraft: view.isDraft, checks, failed, updatedAt, error: null }
  } catch (error) {
    return { ...pr, updatedAt, error: error instanceof Error ? error.message : String(error) }
  }
}

const refreshAll = async ($: EngineInterface) => {
  const list = await read($, prs)
  if (list.length === 0) return
  const fresh = await Promise.all(list.map(pr => fetchPr($, pr)))
  await update($, prs, current =>
    current.map(pr => fresh.find(one => one.url === pr.url) ?? pr),
  )
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

const summaryOf = (list: Pr[]) => {
  const total = list.reduce(
    (sum, pr) => ({
      pass: sum.pass + pr.checks.pass,
      fail: sum.fail + pr.checks.fail,
      pending: sum.pending + pr.checks.pending,
    }),
    { pass: 0, fail: 0, pending: 0 },
  )
  return `✓${total.pass} ✗${total.fail} …${total.pending}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prs',
      description: 'Toggle the list of PRs created in this session and refresh their CI status',
    })
    $.clock.every(REFRESH_MS, () => void refreshAll($))

    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    const hidden = await update($, isHidden, value => !value)
    await refreshAll($)
    const list = await read($, prs)
    if (list.length === 0) return { text: 'No PR has been created in this session yet.' }
    const lines = list.map(pr => `#${pr.number} ${pr.state}${pr.isDraft ? ' (draft)' : ''} ${summaryOf([pr])} ${pr.title}`)

    return { text: `${hidden ? 'Hidden' : 'Shown'}. ${list.length} PR(s):\n${lines.join('\n')}` }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!CREATES_PR.test(e.command) || ran.deny !== undefined) return ran
    const urls = [...new Set(ran.text?.match(PR_URL) ?? [])]
    if (urls.length > 0) void addPrs($, urls)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, prs)
    if (e.props.hasSurvey || list.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const hidden = await read($, isHidden)
    const toggle = () => update($, isHidden, value => !value)

    if (hidden) {
      return (
        <Box>
          <Button key="toggle" plain dimColor onPress={toggle}>
            ▸ PRs {list.length} {summaryOf(list)}
          </Button>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>PRs in this session ({list.length}) </Text>
          <Button key="toggle" label="Hide" onPress={toggle} />
          <Text> </Text>
          <Button key="refresh" label="Refresh" onPress={() => refreshAll($)} />
        </Box>
        {list.map(pr => (
          <Box key={pr.url}>
            <Text color={pr.checks.fail > 0 ? 'error' : pr.checks.pending > 0 ? 'warning' : 'success'}>
              {pr.checks.fail > 0 ? '✗' : pr.checks.pending > 0 ? '…' : '✓'}
            </Text>
            <Text> #{pr.number} </Text>
            <Text color={pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'error' : 'text'}>
              {pr.state}{pr.isDraft ? ' draft' : ''}
            </Text>
            <Text dimColor> {summaryOf([pr])} </Text>
            <Text wrap="truncate">{pr.title || pr.url}</Text>
            {pr.failed.length > 0 && <Text color="error"> failed: {pr.failed.join(', ')}</Text>}
            {pr.error !== null && <Text color="warning"> ({pr.error})</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
