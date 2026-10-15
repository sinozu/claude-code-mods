export type Bucket = 'pass' | 'fail' | 'pending' | 'skipped'

export type Checks = Record<Bucket, number>

export type CheckRun = { name: string; bucket: Bucket }

export type Pr = {
  url: string
  number: number
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED' | 'UNKNOWN'
  isDraft: boolean
  headRefName: string
  baseRefName: string
  additions: number
  deletions: number
  reviewDecision: string
  mergeStateStatus: string
  checks: Checks
  runs: CheckRun[]
  updatedAt: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'session-prs': { prs: Pr[]; isOpen: boolean }
  }
}
