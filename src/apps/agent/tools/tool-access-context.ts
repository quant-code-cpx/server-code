import { UserRole, UserStatus } from '@prisma/client'
import type { AgentToolKey } from '../contracts'

export interface ToolExecutionContext {
  userId: number
  role: UserRole
  userStatus: UserStatus
  scopeId: string
  conversationId: string
  runId: string
  stepId: string
  traceId: string
  workflowAllowedTools: readonly AgentToolKey[]
  allowedScopes: readonly string[]
  callsUsed: number
  deadlineAt: Date
  parentSignal?: AbortSignal
  maxConcurrentCalls?: number
}

export interface ToolAccessContext extends ToolExecutionContext {
  toolCallId: string
  attempt: number
  abortSignal: AbortSignal
}
