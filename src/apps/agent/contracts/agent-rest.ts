import type { AgentCapability, AgentRunStatus, ConversationStatus, ModelPolicy } from './agent-status'
import type { MessageBlock } from './message-blocks'

export type OpaqueAgentId = string

export interface PageContext {
  route: string
  entityType?: 'STOCK' | 'INDEX' | 'PORTFOLIO' | 'BACKTEST' | 'REPORT'
  entityId?: string
  selectedRange?: { start: string; end: string }
  visibleDataAsOf?: string
}

export interface CreateConversationRequest {
  clientRequestId: string
  title: string
  modelPolicy: ModelPolicy
  preferredModel: string | null
}

export interface CreateConversationResponse {
  conversationId: OpaqueAgentId
  status: ConversationStatus
  createdAt: string
}

export interface ListConversationsRequest {
  cursor: string | null
  limit: number
  includeArchived: boolean
}

export interface ConversationDetailRequest {
  conversationId: OpaqueAgentId
}

export interface ListMessagesRequest {
  conversationId: OpaqueAgentId
  beforeMessageId: OpaqueAgentId | null
  limit: number
}

export interface SendMessageRequest {
  clientRequestId: string
  conversationId: OpaqueAgentId
  content: string
  pageContext?: PageContext
  modelPolicy: ModelPolicy
  allowedCapabilities: AgentCapability[]
}

export interface SendMessageResponse {
  conversationId: OpaqueAgentId
  userMessageId: OpaqueAgentId
  assistantMessageId: OpaqueAgentId
  runId: OpaqueAgentId
  runStatus: AgentRunStatus
  streamEndpoint: '/api/agent/runs/events'
}

export interface RegenerateMessageRequest {
  clientRequestId: string
  messageId: OpaqueAgentId
  modelPolicy: ModelPolicy
}

export interface UpdateConversationModelRequest {
  conversationId: OpaqueAgentId
  modelPolicy: ModelPolicy
  preferredModel: string | null
}

export interface RunEventsRequest {
  runId: OpaqueAgentId
  afterSequence: number
}

export interface RunStatusRequest {
  runId: OpaqueAgentId
}

export interface CancelRunRequest {
  runId: OpaqueAgentId
  expectedStatusVersion: number
}

export interface ListToolCallsRequest {
  runId: OpaqueAgentId
  includePayload: boolean
}

export interface AgentMessageContract {
  messageId: OpaqueAgentId
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  status: 'PENDING' | 'STREAMING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  contentBlocks: MessageBlock[]
  createdAt: string
}
