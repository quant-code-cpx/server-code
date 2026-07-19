import type {
  AiAgentRunStatus,
  AiAgentStepKind,
  AiAgentStepStatus,
  AiModelPolicy,
  AiRunEventVisibility,
} from '@prisma/client'

export interface CreateAgentRunCommand {
  userId: number
  conversationId: string
  triggerMessageId: string
  responseMessageId: string
  clientRequestId: string
  traceId: string
  workflowVersionId: string
  promptVersionId: string
  toolPolicyVersion: string
  modelPolicy: AiModelPolicy
  preferredModel?: string | null
  inputSnapshot: unknown
  budget?: unknown
  maxAttempts?: number
  deadlineAt: Date
}

export interface AgentEventInput {
  eventType: string
  traceId: string
  payload: unknown
  stepId?: string | null
  visibility?: AiRunEventVisibility
}

export interface AppendAgentEventCommand extends AgentEventInput {
  workerId: string
}

export interface TransitionAgentRunCommand {
  workerId: string
  expectedVersion: number
  targetStatus: AiAgentRunStatus
  event: AgentEventInput
  resultSummary?: unknown
  errorCode?: number | null
  errorClass?: string | null
  errorMessage?: unknown
}

export interface RequestAgentRunCancelCommand {
  userId: number
  runId: string
  expectedVersion: number
  reason?: string | null
}

export interface SaveAgentCheckpointCommand {
  workerId: string
  expectedCheckpointVersion: number
  checkpoint: unknown
}

export interface CreateAgentStepCommand {
  stepKey: string
  kind: AiAgentStepKind
  ordinal: number
  attempt?: number
  parentStepId?: string | null
  input: unknown
}

export interface TransitionAgentStepCommand {
  workerId: string
  targetStatus: AiAgentStepStatus
  event: AgentEventInput
  output?: unknown
  errorCode?: number | null
  errorClass?: string | null
  errorMessage?: unknown
}
