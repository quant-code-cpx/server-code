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
import { ConversationContextCompatibilityService } from '../memory/conversation-context-compatibility.service'
import type { ModelDescriptor } from '../model-gateway/model-gateway.port'
import type { WorkflowModelProfile } from '../workflow/workflow.types'

@Injectable()
export class AgentConversationService {
  constructor(
    private readonly conversations: AgentConversationRepository,
    private readonly reads: AgentRestReadRepository,
    private readonly models: ModelCapabilityRegistry,
    private readonly health: ProviderHealthService,
    @Inject(ModelConfig.KEY) private readonly modelConfig: IModelConfig,
    private readonly summaries: ConversationSummaryService,
    private readonly contextCompatibility: ConversationContextCompatibilityService,
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
    const targetProfile = this.resolveTargetProfile(dto.modelPolicy, preferredModel)
    const contextPreparation = await this.contextCompatibility.assess(userId, dto.conversationId, targetProfile)
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
      contextPreparation,
      updatedAt: conversation.updatedAt.toISOString(),
    }
  }

  listModels() {
    return {
      items: this.models.list().map((descriptor) => {
        const provider =
          this.models.getProviderConfig(descriptor.provider) ??
          this.modelConfig.providers.find((item) => item.id === descriptor.provider)
        const health = this.health.snapshot(descriptor)
        const supportsConversationData = descriptor.dataClasses.includes('USER_PRIVATE')
        const supportsAgentWorkflow = supportsRequiredAgentCapabilities(descriptor)
        const healthy = health.status === 'HEALTHY'
        return {
          model: descriptor.model,
          displayName: provider?.displayName ?? descriptor.provider,
          provider: descriptor.provider,
          capabilities: descriptor.capabilities,
          contextWindow: descriptor.contextWindow,
          maxOutputTokens: descriptor.maxOutputTokens,
          costTier: provider?.costTier ?? 'MEDIUM',
          status: healthy && supportsConversationData && supportsAgentWorkflow ? 'AVAILABLE' : 'UNAVAILABLE',
          reason: !supportsConversationData
            ? '模型未允许处理用户私有数据'
            : !supportsAgentWorkflow
              ? '模型不支持智能体所需的流式或结构化输出能力'
              : healthy
                ? null
                : '模型供应商暂时不可用',
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
      if (!descriptor.dataClasses.includes('USER_PRIVATE')) throw new Error('data class unsupported')
      if (!supportsRequiredAgentCapabilities(descriptor)) throw new Error('capability unsupported')
      if (!this.health.isAvailable(descriptor)) throw new Error('model unavailable')
    } catch {
      throw validationError('preferredModel 未注册或不可用')
    }
    return preferredModel
  }

  private resolveTargetProfile(modelPolicy: AiModelPolicy, preferredModel: string | null): WorkflowModelProfile {
    if (modelPolicy === AiModelPolicy.MANUAL && preferredModel) {
      const descriptor = this.models.get(preferredModel)
      return toModelProfile(descriptor, [descriptor])
    }
    const candidates = this.models
      .list()
      .filter(
        (candidate) =>
          candidate.dataClasses.includes('USER_PRIVATE') &&
          supportsRequiredAgentCapabilities(candidate) &&
          this.health.isAvailable(candidate),
      )
    const selected = candidates[0]
    if (!selected) throw validationError('当前没有可用于会话的健康模型')
    return toModelProfile(selected, candidates)
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

function supportsRequiredAgentCapabilities(descriptor: ModelDescriptor): boolean {
  return descriptor.capabilities.includes('STREAMING') && descriptor.capabilities.includes('STRUCTURED_OUTPUT')
}

function toModelProfile(selected: ModelDescriptor, candidates: readonly ModelDescriptor[]): WorkflowModelProfile {
  return {
    selectedProvider: selected.provider,
    selectedModel: selected.model,
    candidates: [...candidates],
  }
}

function validationError(message: string): BadRequestException {
  return new BadRequestException([message])
}
