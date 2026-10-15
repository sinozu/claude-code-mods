import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PR = 'https://github.com/example/repo/pull/12'

const view = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    number: 12,
    title: 'fix: shipping job',
    state: 'OPEN',
    isDraft: true,
    headRefName: 'fix-shipping-job',
    baseRefName: 'main',
    additions: 12,
    deletions: 3,
    reviewDecision: 'REVIEW_REQUIRED',
    mergeStateStatus: 'BLOCKED',
    statusCheckRollup: [
      { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'test', status: 'IN_PROGRESS', conclusion: null },
      { __typename: 'StatusContext', context: 'coverage', state: 'FAILURE' },
    ],
    ...overrides,
  })

const bandProps = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}

const paneProps = {
  title: 'PRs',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

const engine = (on: On) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 'test-session' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`records a PR from gh pr create and the band toggles the pane (${surface})`, async ($, on) => {
    engine(on)
    const ran: string[][] = []
    const opened: string[] = []
    const closed: string[] = []
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: `${PR}\n`, stderr: '' }, text: `${PR}\n` }))
    on('process.run', (_, e) => {
      ran.push([...e.argv])
      return ok(view())
    })
    on('ui.open', (_, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    on('ui.close', (_, e) => {
      closed.push(e.id)
      return { value: undefined }
    })

    await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "fix: shipping job" --body x' })
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --title again' })
    await $.tool.call({ tool: 'Bash', command: 'git status' })
    expect(ran.filter(argv => argv[0] === 'gh' && argv[3] === PR).length).toBeGreaterThan(0)

    const band = await $.ui.mount({ plugin: 'session-prs', surface, component: 'AbovePrompt', props: bandProps })
    expect(await band.find({ text: /PRs 1/ })).toBeDefined()
    expect(await band.find({ key: 'toggle' })).toMatchObject({ text: 'Panel ○' })

    await band.press({ key: 'toggle' })
    expect(opened).toEqual(['session-prs'])
    expect(await band.find({ key: 'toggle' })).toMatchObject({ text: 'Panel ●' })

    const pane = await $.ui.mount({ plugin: 'session-prs', surface, component: 'Pane', props: paneProps, requestId: 'session-prs' })
    expect(await pane.find({ text: /#12/ })).toBeDefined()
    expect(await pane.find({ text: /DRAFT/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /✗ coverage/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /◌ test/ })).toBeDefined()
    expect(await pane.find({ text: /fix-shipping-job/ })).toBeDefined()
    expect(await pane.find({ text: /review required/ })).toBeDefined()
    expect(await pane.find({ text: /blocked/ })).toBeDefined()
    expect(await pane.find({ text: /\+12/ })).toBeDefined()
    expect((await pane.findAll({ type: 'Text', text: /#12/ })).length).toBe(1)
    expect(await pane.find({ type: 'Link' })).toBeDefined()

    await pane.press({ key: 'close' })
    expect(closed).toEqual(['session-prs'])
    expect(await band.find({ key: 'toggle' })).toMatchObject({ text: 'Panel ○' })
  })
}

test('draws the band with the panel button before any PR is created', async ($, on) => {
  engine(on)
  const band = await $.ui.mount({ plugin: 'session-prs', surface: 'terminal', component: 'AbovePrompt', props: bandProps })
  expect(await band.find({ text: /PRs 0/ })).toBeDefined()
  expect(await band.find({ key: 'toggle' })).toMatchObject({ text: 'Panel ○' })
})

test('restores the list from the store after a relaunch', async ($, on) => {
  mock.clock(on)
  on('session.id', () => ({ value: 'test-session' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  mock.store(on, {
    'prs:test-session': [
      { url: PR, number: 12, title: 'restored', state: 'OPEN', isDraft: false, headRefName: '', baseRefName: '', additions: 0, deletions: 0, reviewDecision: '', mergeStateStatus: '', checks: { pass: 0, fail: 0, pending: 0, skipped: 0 }, runs: [], updatedAt: 0, error: null },
    ],
    'open:test-session': true,
  })
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect(opened).toEqual(['session-prs'])
  const band = await $.ui.mount({ plugin: 'session-prs', surface: 'terminal', component: 'AbovePrompt', props: bandProps })
  expect(await band.find({ text: /PRs 1/ })).toBeDefined()
  expect(await band.find({ key: 'toggle' })).toMatchObject({ text: 'Panel ●' })
})

test('/prs opens the pane, then closes it', async ($, on) => {
  engine(on)
  const opened: string[] = []
  const closed: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  const run = () => $.command.run({ command: 'prs', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect((await run()).text).toContain('opened')
  expect(opened).toEqual(['session-prs'])
  expect((await run()).text).toContain('closed')
  expect(closed).toEqual(['session-prs'])
})
