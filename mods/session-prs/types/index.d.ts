export type Checks = { pass: number; fail: number; pending: number; skipped: number }

export type Pr = {
  url: string
  number: number
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED' | 'UNKNOWN'
  isDraft: boolean
  checks: Checks
  failed: string[]
  updatedAt: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-prs': { prs: Pr[]; isHidden: boolean }
  }
}
