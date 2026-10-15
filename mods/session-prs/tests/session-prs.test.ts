import { expect, mock, test } from 'claude-code/testing'

const PR = 'https://github.com/example/repo/pull/12'

const view = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    number: 12,
    title: 'fix: shipping job',
    state: 'OPEN',
    isDraft: true,
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

for (const surface of ['terminal', 'desktop'] as const) {
  test(`records a PR from gh pr create and toggles the list (${surface})`, async ($, on) => {
    mock.clock(on)
    const ran: string[][] = []
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: `${PR}\n`, stderr: '' }, text: `${PR}\n` }))
    on('process.run', (_, e) => {
      ran.push([...e.argv])
      return { value: { exitCode: 0, stdout: view(), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })

    await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "fix: shipping job" --body x' })
    await $.tool.call({ tool: 'Bash', command: 'gh pr create --title again' })
    await $.tool.call({ tool: 'Bash', command: 'git status' })

    expect(ran.filter(argv => argv[0] === 'gh' && argv[3] === PR).length).toBeGreaterThan(0)

    const band = await $.ui.mount({ plugin: 'session-prs', surface, component: 'AbovePrompt', props: bandProps })
    expect(await band.find({ text: /#12/ })).toBeDefined()
    expect(await band.find({ text: /draft/ })).toBeDefined()
    expect(await band.find({ text: /failed: coverage/ })).toBeDefined()
    expect(await band.find({ text: /✓1 ✗1 …1/ })).toBeDefined()
    expect((await band.findAll({ type: 'Text', text: /#12/ })).length).toBe(1)

    await band.press({ key: 'toggle' })
    expect(await band.find({ text: /draft/ })).toBeUndefined()
    expect(await band.find({ text: /PRs 1/ })).toBeDefined()

    await band.press({ key: 'toggle' })
    expect(await band.find({ text: /draft/ })).toBeDefined()
  })
}

test('draws nothing before any PR is created', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  const band = await $.ui.mount({ plugin: 'session-prs', surface: 'terminal', component: 'AbovePrompt', props: bandProps })
  expect(await band.find({ key: 'toggle' })).toBeUndefined()
})

test('/prs refreshes and reports the list', async ($, on) => {
  mock.clock(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: `${PR}\n`, stderr: '' }, text: `${PR}\n` }))
  let calls = 0
  on('process.run', () => {
    calls += 1
    return { value: { exitCode: 0, stdout: view({ state: 'MERGED', isDraft: false }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create' })
  const before = calls
  const answer = await $.command.run({
    command: 'prs',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(calls).toBeGreaterThan(before)
  expect(answer.text).toContain('#12 MERGED')
})
