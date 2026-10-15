import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PR = 'https://github.com/example/repo/pull/7'

const APPROVED_BY_ME = 'https://github.com/example/repo/pull/8'
const APPROVED_OVERALL = 'https://github.com/example/repo/pull/9'

const found = (number: number, url: string) => ({
  number,
  title: `feat: thing ${number}`,
  url,
  isDraft: false,
  updatedAt: '2026-10-15T00:00:00Z',
  author: { login: 'alice' },
  repository: { nameWithOwner: 'example/repo' },
})

const search = JSON.stringify([found(7, PR), found(8, APPROVED_BY_ME), found(9, APPROVED_OVERALL)])

const viewOf = (url: string) =>
  url === APPROVED_BY_ME
    ? JSON.stringify({ additions: 1, deletions: 1, reviewDecision: 'REVIEW_REQUIRED', latestReviews: [{ author: { login: 'me' }, state: 'APPROVED' }], statusCheckRollup: [] })
    : url === APPROVED_OVERALL
      ? JSON.stringify({ additions: 1, deletions: 1, reviewDecision: 'APPROVED', latestReviews: [{ author: { login: 'bob' }, state: 'APPROVED' }], statusCheckRollup: [] })
      : view

const view = JSON.stringify({
  additions: 5,
  deletions: 1,
  reviewDecision: '',
  latestReviews: [{ author: { login: 'me' }, state: 'COMMENTED' }],
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
  ],
})

const bandProps = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} }
const paneProps = { title: 'Reviews', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} }

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

const engine = (on: On) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 'test-session' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('process.run', (_, e) => ok(e.argv[1] === 'api' ? 'me\n' : e.argv[1] === 'search' ? search : viewOf(e.argv[3] ?? '')))
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`fetches review requests at start and draws them (${surface})`, async ($, on) => {
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

    await $.session.start({ cwd: '/tmp', surface, isInteractive: true })

    const band = await $.ui.mount({ plugin: 'review-requests', surface, component: 'AbovePrompt', props: bandProps })
    expect(await band.find({ text: /Reviews/ })).toBeDefined()
    expect(await band.find({ text: /1 with failing CI/ })).toBeDefined()
    expect(await band.find({ key: 'toggle' })).toMatchObject({ text: 'Panel ○' })

    await band.press({ key: 'toggle' })
    expect(opened).toEqual(['review-requests'])

    const pane = await $.ui.mount({ plugin: 'review-requests', surface, component: 'Pane', props: paneProps, requestId: 'review-requests' })
    expect(await pane.find({ text: /example\/repo/ })).toBeDefined()
    expect(await pane.find({ text: /#7/ })).toBeDefined()
    expect(await pane.find({ text: /#8/ })).toBeUndefined()
    expect(await pane.find({ text: /#9/ })).toBeUndefined()
    expect(await band.find({ text: /Reviews/ })).toBeDefined()
    expect((await band.find({ type: 'Text', text: /^ 1 $/ }))).toBeDefined()
    expect(await pane.find({ text: /@alice/ })).toBeDefined()
    expect(await pane.find({ text: /waiting for review/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^test$/ })).toBeDefined()
    expect(await pane.find({ type: 'Link' })).toBeDefined()

    await pane.press({ key: 'close' })
    expect(closed).toEqual(['review-requests'])
    expect(await band.find({ key: 'toggle' })).toMatchObject({ text: 'Panel ○' })
  })
}

test('/reviews toggles the pane', async ($, on) => {
  engine(on)
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  const run = () => $.command.run({ command: 'reviews', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  expect((await run()).text).toContain('opened')
  expect(opened).toEqual(['review-requests'])
  expect((await run()).text).toContain('closed')
})

test('reports a gh failure in the band instead of a list', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.id', () => ({ value: 'test-session' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))
  on('process.run', () => ({ value: { exitCode: 4, stdout: '', stderr: 'gh: not logged in\n', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'review-requests', surface: 'terminal', component: 'AbovePrompt', props: bandProps })
  expect(await band.find({ text: /not logged in/ })).toBeDefined()
})
