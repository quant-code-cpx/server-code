import { BadRequestException, Injectable } from '@nestjs/common'
import { AiModelPolicy } from '@prisma/client'
import { ModelCapabilityRegistry } from '../model-gateway/model-capability.registry'
import { AgentConversationRepository } from '../conversation/agent-conversation.repository'
import { AgentRestReadRepository } from '../api/agent-rest-read.repository'
import type {
  ConversationDetailDto,
  CreateConversationDto,
  ListConversationMessagesDto,
  ListConversationsDto,
  UpdateConversationModelDto,
} from '../api/dto/conversation/conversation-request.dto'

@Injectable()
export class AgentConversationService {
  constructor(
    private readonly conversations: AgentConversationRepository,
    private readonly reads: AgentRestReadRepository,
    private readonly models: ModelCapabilityRegistry,
  ) {}

  async create(userId: number, dto: CreateConversationDto) {
    const preferredModel = this.validateModelSelection(dto.modelPolicy, dto.preferredModel)
    const conversation = await this.conversations.createConversation(userId, { ...dto, preferredModel })
    return {
      conversationId: conversation.id,
      status: conversation.status,
      createdAt: conversation.createdAt.toISOString(),
    }
  }

  async list(userId: number, dto: ListConversationsDto) {
    const page = await this.conversations.listByCursor(userId, dto)
    return {
      items: page.items.map((conversation) => this.mapConversation(conversation)),
      nextCursor: page.nextCursor,
    }
  }

  async detail(userId: number, dto: ConversationDetailDto) {
    const conversation = await this.conversations.findById(userId, dto.conversationId)
    return { ...this.mapConversation(conversation), statusVersion: conversation.statusVersion }
  }

  listMessages(userId: number, dto: ListConversationMessagesDto) {
    return this.reads.listMessages(userId, dto.conversationId, dto.beforeMessageId, dto.limit)
  }

  async updateModel(userId: number, dto: UpdateConversationModelDto) {
    const preferredModel = this.validateModelSelection(dto.modelPolicy, dto.preferredModel)
    const conversation = await this.conversations.updateModelPolicy(
      userId,
      dto.conversationId,
      dto.modelPolicy,
      preferredModel,
    )
    return {
      conversationId: conversation.id,
      modelPolicy: conversation.modelPolicy,
      preferredModel: conversation.preferredModel,
      updatedAt: conversation.updatedAt.toISOString(),
    }
  }

  validateModelSelection(modelPolicy: AiModelPolicy, preferredModel: string | null): string | null {
    if (modelPolicy === AiModelPolicy.AUTO) {
      if (preferredModel) throw validationError('AUTO modelPolicy 不允许指定 preferredModel')
      return null
    }
    if (!preferredModel) throw validationError('MANUAL modelPolicy 必须指定 preferredModel')
    try {
      this.models.get(preferredModel)
    } catch {
      throw validationError('preferredModel 未注册或不可用')
    }
    return preferredModel
  }

  private mapConversation(conversation: Awaited<ReturnType<AgentConversationRepository['findById']>>) {
    return {
      conversationId: conversation.id,
      title: conversation.title,
      status: conversation.status,
      modelPolicy: conversation.modelPolicy,
      preferredModel: conversation.preferredModel,
      messageCount: conversation.messageCount,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    }
  }
}

function validationError(message: string): BadRequestException {
  return new BadRequestException([message])
}
