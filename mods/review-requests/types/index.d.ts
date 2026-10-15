export type Bucket = 'pass' | 'fail' | 'pending' | 'skipped'

export type Checks = Record<Bucket, number>

export type ReviewPr = {
  url: string
  repo: string
  number: number
  title: string
  author: string
  isDraft: boolean
  updatedAt: string
  additions: number
  deletions: number
  reviewDecision: string
  checks: Checks
  failed: string[]
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'review-requests': { prs: ReviewPr[]; isOpen: boolean; fetchedAt: number; error: string | null }
  }
}
