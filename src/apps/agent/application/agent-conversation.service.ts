import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { AiModelPolicy } from '@prisma/client'
import { ModelConfig, type IModelConfig } from 'src/config/model.config'
import { ModelCapabilityRegistry } from '../model-gateway/model-capability.registry'
import { ProviderHealthService } from '../model-gateway/provider-health.service'
import { AgentConversationRepository } from '../conversation/agent-conversation.repository'
import { AgentRestReadRepository } from '../api/agent-rest-read.repository'
import type {
  ConversationDetailDto,
  CreateConversationDto,
  ListConversationMessagesDto,
  ListConversationsDto,
  UpdateConversationModelDto,
} from '../api/dto/conversation/conversation-request.dto'
import { ConversationSummaryService } from '../memory/conversation-summary.service'

@Injectable()
export class AgentConversationService {
  constructor(
    private readonly conversations: AgentConversationRepository,
    private readonly reads: AgentRestReadRepository,
    private readonly models: ModelCapabilityRegistry,
    private readonly health: ProviderHealthService,
    @Inject(ModelConfig.KEY) private readonly modelConfig: IModelConfig,
    private readonly summaries: ConversationSummaryService,
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
    const currentSummary = await this.summaries.currentMetadata(userId, dto.conversationId)
    return { ...this.mapConversation(conversation), statusVersion: conversation.statusVersion, currentSummary }
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

  listModels() {
    return {
      items: this.modelConfig.providers.map((provider) => {
        const descriptor = this.models.get(provider.defaultModel)
        const health = this.health.snapshot(descriptor)
        return {
          model: descriptor.model,
          displayName: provider.displayName,
          provider: descriptor.provider,
          capabilities: descriptor.capabilities,
          costTier: provider.costTier,
          status: health.status === 'HEALTHY' ? 'AVAILABLE' : 'UNAVAILABLE',
          reason: health.status === 'HEALTHY' ? null : '模型供应商暂时不可用',
        }
      }),
    }
  }

  validateModelSelection(modelPolicy: AiModelPolicy, preferredModel: string | null): string | null {
    if (modelPolicy === AiModelPolicy.AUTO) {
      if (preferredModel) throw validationError('AUTO modelPolicy 不允许指定 preferredModel')
      return null
    }
    if (!preferredModel) throw validationError('MANUAL modelPolicy 必须指定 preferredModel')
    try {
      const descriptor = this.models.get(preferredModel)
      if (!this.health.isAvailable(descriptor)) throw new Error('circuit open')
      if (!descriptor.dataClasses.includes('USER_PRIVATE')) throw new Error('data class unsupported')
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
