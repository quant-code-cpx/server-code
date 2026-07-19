import type { AiConversation, AiMessage, AiMessageRole, AiMessageStatus, AiModelPolicy } from '@prisma/client'
import type { MessageBlock } from '../contracts'

export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
}

export interface CreateConversationCommand {
  clientRequestId: string
  title: string
  modelPolicy: AiModelPolicy
  preferredModel: string | null
}

export interface ListConversationsQuery {
  cursor?: string | null
  limit: number
  includeArchived: boolean
}

export interface AppendMessageCommand {
  clientRequestId?: string | null
  role: AiMessageRole
  status: AiMessageStatus
  contentText?: string | null
  contentBlocks: unknown
  parentMessageId?: string | null
  version?: number
  modelName?: string | null
  tokenCount?: number | null
  completedAt?: Date | null
}

export interface CreateAssistantVersionCommand {
  clientRequestId: string
  modelName?: string | null
}

export interface ListMessagesQuery {
  cursor?: string | null
  limit: number
}

export type PersistedAiMessage = Omit<AiMessage, 'contentBlocks'> & {
  contentBlocks: MessageBlock[]
}

export type PersistedAiConversation = AiConversation
