import type { NewsIngestionRunStatus } from '@prisma/client'

export type NewsRunClaimDecision = 'CLAIM' | 'WAIT' | 'TERMINAL'

export function newsRunClaimRetryAfterMs(input: { startedAt: Date; now: Date; staleAfterMs: number }): number {
  if (!Number.isFinite(input.startedAt.getTime()) || !Number.isFinite(input.now.getTime())) {
    throw new Error('startedAt/now 必须是合法时间')
  }
  if (!Number.isInteger(input.staleAfterMs) || input.staleAfterMs < 1) {
    throw new Error('staleAfterMs 必须是正整数')
  }
  const elapsedMs = Math.max(0, input.now.getTime() - input.startedAt.getTime())
  return Math.max(1_000, input.staleAfterMs - elapsedMs + 1_000)
}

export function decideNewsRunClaim(_input: {
  status: NewsIngestionRunStatus
  startedAt: Date | null
  now: Date
  staleAfterMs: number
}): NewsRunClaimDecision {
  const input = _input
  if (!Number.isFinite(input.now.getTime())) throw new Error('now 必须是合法时间')
  if (!Number.isInteger(input.staleAfterMs) || input.staleAfterMs < 1) throw new Error('staleAfterMs 必须是正整数')
  if (input.status === 'QUEUED' || input.status === 'FAILED') return 'CLAIM'
  if (input.status !== 'RUNNING') return 'TERMINAL'
  if (!input.startedAt || !Number.isFinite(input.startedAt.getTime())) return 'CLAIM'
  return input.now.getTime() - input.startedAt.getTime() >= input.staleAfterMs ? 'CLAIM' : 'WAIT'
}
