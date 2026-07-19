import { Inject, Injectable } from '@nestjs/common'
import {
  AiAgentRunStatus,
  AiConversationStatus,
  AiMessageRole,
  AiMessageStatus,
  AiModelPolicy,
  AiVersionStatus,
  Prisma,
  type AiAgentRun,
  type AiConversation,
} from '@prisma/client'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { AgentApiConfig, type IAgentApiConfig } from 'src/config/agent-api.config'
import { AgentExecutionConfig, type IAgentExecutionConfig } from 'src/config/agent-execution.config'
import { createAgentJob, hashAgentJob } from 'src/queue/agent/agent-job.interface'
import { AGENT_JOB_OUTBOX_KIND } from 'src/queue/agent/agent.queue.constants'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { canonicalJson, sha256 } from '../audit/agent-audit-sanitizer'
import {
  AgentConversationArchivedError,
  AgentConversationNotFoundError,
  AgentMessageValidationError,
} from '../conversation/agent-conversation.errors'
import { AgentRunIdempotencyConflictError } from '../execution/agent-execution.errors'
import { AgentEventRepository } from '../execution/agent-event.repository'
import { WorkflowVersionError } from '../workflow/workflow.errors'
import { ModelCapabilityRegistry } from '../model-gateway/model-capability.registry'

dayjs.extend(utc)
dayjs.extend(timezone)

export interface AgentWorkflowPin {
  workflowKey: string
  workflowVersion: number
  workflowContentHash: string
  promptKey: string
  promptVersion: number
  promptContentHash: string
}

export interface SendInteractionCommand {
  userId: number
  clientRequestId: string
  conversationId: string
  content: string
  pageContext: Record<string, unknown>
  modelPolicy: AiModelPolicy
  allowedCapabilities: string[]
  allowedScopes: string[]
  traceId: string
  workflow: AgentWorkflowPin
}

export interface RegenerateInteractionCommand {
  userId: number
  clientRequestId: string
  sourceMessageId: string
  modelPolicy: AiModelPolicy
  traceId: string
  workflow: AgentWorkflowPin
}

export interface CreatedAgentInteraction {
  conversationId: string
  triggerMessageId: string
  responseMessageId: string
  sourceMessageId: string | null
  run: AiAgentRun
}

class AgentRunQuotaExceededError extends Error {
  readonly code = 'AI_COST_QUOTA_EXCEEDED'

  constructor(message: string) {
    super(message)
    this.name = AgentRunQuotaExceededError.name
  }
}

@Injectable()
export class AgentInteractionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AgentEventRepository,
    @Inject(AgentApiConfig.KEY) private readonly apiConfig: IAgentApiConfig,
    @Inject(AgentExecutionConfig.KEY) private readonly executionConfig: IAgentExecutionConfig,
    private readonly models: ModelCapabilityRegistry,
    private readonly logger: LoggerService,
  ) {}

  async send(command: SendInteractionCommand): Promise<CreatedAgentInteraction> {
    const startedAt = Date.now()
    const requestHash = hashRequest({
      operation: 'SEND',
      conversationId: command.conversationId,
      content: command.content,
      pageContext: command.pageContext,
      modelPolicy: command.modelPolicy,
      allowedCapabilities: [...command.allowedCapabilities].sort(),
    })
    const result = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, command.userId)
      const existing = await findRunByRequest(tx, command.userId, command.clientRequestId)
      if (existing) return resolveExisting(existing, requestHash, null)

      const conversation = await this.findWritableConversation(tx, command.userId, command.conversationId)
      const preferredModel = this.resolvePreferredModel(command.modelPolicy, conversation)
      const quota = await this.assertQuotaAndResolveBudget(tx, command.userId)
      const versions = await this.resolvePublishedVersions(tx, command.workflow)
      const now = new Date()
      const userMessage = await tx.aiMessage.create({
        data: {
          userId: command.userId,
          conversationId: conversation.id,
          role: AiMessageRole.USER,
          status: AiMessageStatus.COMPLETED,
          contentText: command.content,
          contentBlocks: [{ blockId: 'user_text', schemaVersion: 1, type: 'MARKDOWN', text: command.content }],
          clientRequestId: command.clientRequestId,
          completedAt: now,
          createdAt: now,
        },
      })
      const assistantMessage = await tx.aiMessage.create({
        data: {
          userId: command.userId,
          conversationId: conversation.id,
          role: AiMessageRole.ASSISTANT,
          status: AiMessageStatus.PENDING,
          contentBlocks: [],
          parentMessageId: userMessage.id,
          version: 1,
          modelName: preferredModel,
          createdAt: now,
        },
      })
      const run = await this.createRun(tx, {
        userId: command.userId,
        conversation,
        triggerMessageId: userMessage.id,
        responseMessageId: assistantMessage.id,
        clientRequestId: command.clientRequestId,
        requestHash,
        traceId: command.traceId,
        modelPolicy: command.modelPolicy,
        preferredModel,
        workflowVersionId: versions.workflowVersionId,
        promptVersionId: versions.promptVersionId,
        inputSnapshot: {
          schemaVersion: 1,
          userText: command.content,
          pageContext: command.pageContext,
          allowedCapabilities: command.allowedCapabilities,
          allowedScopes: command.allowedScopes,
        },
        budget: quota,
      })
      await tx.aiConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, messageCount: { increment: 2 } },
      })
      return {
        conversationId: conversation.id,
        triggerMessageId: userMessage.id,
        responseMessageId: assistantMessage.id,
        sourceMessageId: null,
        run,
      }
    })
    this.logOperation('send', startedAt, result.run.id)
    return result
  }

  async regenerate(command: RegenerateInteractionCommand): Promise<CreatedAgentInteraction> {
    const startedAt = Date.now()
    const requestHash = hashRequest({
      operation: 'REGENERATE',
      sourceMessageId: command.sourceMessageId,
      modelPolicy: command.modelPolicy,
    })
    const result = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, command.userId)
      const existing = await findRunByRequest(tx, command.userId, command.clientRequestId)
      if (existing) return resolveExisting(existing, requestHash, command.sourceMessageId)

      const source = await tx.aiMessage.findFirst({
        where: { id: command.sourceMessageId, userId: command.userId },
        include: { responseRuns: { orderBy: { createdAt: 'desc' }, take: 1 } },
      })
      if (!source) throw new AgentConversationNotFoundError()
      if (source.role !== AiMessageRole.ASSISTANT || !source.parentMessageId) {
        throw new AgentMessageValidationError('只能重新生成 assistant message')
      }
      const conversation = await this.findWritableConversation(tx, command.userId, source.conversationId)
      const preferredModel = this.resolvePreferredModel(command.modelPolicy, conversation)
      const parent = await tx.aiMessage.findFirst({
        where: { id: source.parentMessageId, userId: command.userId, conversationId: source.conversationId },
      })
      if (!parent) throw new AgentConversationNotFoundError()
      const previousRun = source.responseRuns[0]
      if (!previousRun) throw new AgentMessageValidationError('目标 assistant message 没有关联 Run')

      const quota = await this.assertQuotaAndResolveBudget(tx, command.userId)
      const versions = await this.resolvePublishedVersions(tx, command.workflow)
      const aggregate = await tx.aiMessage.aggregate({
        where: { parentMessageId: source.parentMessageId },
        _max: { version: true },
      })
      const now = new Date()
      const assistantMessage = await tx.aiMessage.create({
        data: {
          userId: command.userId,
          conversationId: conversation.id,
          role: AiMessageRole.ASSISTANT,
          status: AiMessageStatus.PENDING,
          contentBlocks: [],
          parentMessageId: source.parentMessageId,
          version: (aggregate._max.version ?? 0) + 1,
          clientRequestId: command.clientRequestId,
          modelName: preferredModel,
          createdAt: now,
        },
      })
      const previousInput = asRecord(previousRun.inputSnapshot)
      const run = await this.createRun(tx, {
        userId: command.userId,
        conversation,
        triggerMessageId: parent.id,
        responseMessageId: assistantMessage.id,
        clientRequestId: command.clientRequestId,
        requestHash,
        traceId: command.traceId,
        modelPolicy: command.modelPolicy,
        preferredModel,
        workflowVersionId: versions.workflowVersionId,
        promptVersionId: versions.promptVersionId,
        inputSnapshot: {
          schemaVersion: 1,
          userText: parent.contentText ?? previousInput.userText ?? '',
          pageContext: asRecord(previousInput.pageContext),
          allowedCapabilities: asStringArray(previousInput.allowedCapabilities),
          allowedScopes: asStringArray(previousInput.allowedScopes),
          regeneratedFromMessageId: source.id,
        },
        budget: quota,
      })
      await tx.aiConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, messageCount: { increment: 1 } },
      })
      return {
        conversationId: conversation.id,
        triggerMessageId: parent.id,
        responseMessageId: assistantMessage.id,
        sourceMessageId: source.id,
        run,
      }
    })
    this.logOperation('regenerate', startedAt, result.run.id)
    return result
  }

  private async createRun(
    tx: Prisma.TransactionClient,
    command: {
      userId: number
      conversation: AiConversation
      triggerMessageId: string
      responseMessageId: string
      clientRequestId: string
      requestHash: string
      traceId: string
      modelPolicy: AiModelPolicy
      preferredModel: string | null
      workflowVersionId: string
      promptVersionId: string
      inputSnapshot: Record<string, unknown>
      budget: Record<string, unknown>
    },
  ): Promise<AiAgentRun> {
    const run = await tx.aiAgentRun.create({
      data: {
        userId: command.userId,
        conversationId: command.conversation.id,
        triggerMessageId: command.triggerMessageId,
        responseMessageId: command.responseMessageId,
        clientRequestId: command.clientRequestId,
        requestHash: command.requestHash,
        traceId: command.traceId,
        workflowVersionId: command.workflowVersionId,
        promptVersionId: command.promptVersionId,
        toolPolicyVersion: 'tool-policy-v1',
        modelPolicy: command.modelPolicy,
        preferredModel: command.preferredModel,
        inputSnapshot: command.inputSnapshot as Prisma.InputJsonValue,
        budget: command.budget as Prisma.InputJsonValue,
        maxAttempts: 3,
        deadlineAt: new Date(Date.now() + this.executionConfig.maxDurationMs),
      },
    })
    await this.events.appendInTransaction(tx, run, {
      eventType: 'message.created',
      traceId: run.traceId,
      payload: { messageId: run.responseMessageId, role: AiMessageRole.ASSISTANT, status: AiMessageStatus.PENDING },
    })
    const job = createAgentJob(run.id)
    await tx.aiJobOutbox.create({
      data: { aggregateId: run.id, kind: AGENT_JOB_OUTBOX_KIND, payloadHash: hashAgentJob(job) },
    })
    return tx.aiAgentRun.findUniqueOrThrow({ where: { id: run.id } })
  }

  private async findWritableConversation(
    tx: Prisma.TransactionClient,
    userId: number,
    conversationId: string,
  ): Promise<AiConversation> {
    const conversation = await tx.aiConversation.findFirst({ where: { id: conversationId, userId } })
    if (!conversation || conversation.status === AiConversationStatus.DELETED) {
      throw new AgentConversationNotFoundError()
    }
    if (conversation.status !== AiConversationStatus.ACTIVE) throw new AgentConversationArchivedError()
    return conversation
  }

  private async assertQuotaAndResolveBudget(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<Record<string, unknown>> {
    const activeRuns = await tx.aiAgentRun.count({
      where: {
        userId,
        status: { in: [AiAgentRunStatus.QUEUED, AiAgentRunStatus.RUNNING, AiAgentRunStatus.CANCEL_REQUESTED] },
      },
    })
    if (activeRuns >= this.apiConfig.maxActiveRunsPerUser) {
      throw new AgentRunQuotaExceededError('当前活跃 Agent Run 数量已达上限')
    }
    const shanghaiNow = dayjs().tz('Asia/Shanghai')
    const dailyCost = await tx.aiModelCall.aggregate({
      where: {
        userId,
        costCurrency: 'CNY',
        startedAt: { gte: shanghaiNow.startOf('day').toDate(), lt: shanghaiNow.add(1, 'day').startOf('day').toDate() },
      },
      _sum: { cost: true },
    })
    const used = Number(dailyCost._sum.cost ?? 0)
    const remaining = this.apiConfig.defaultDailyBudget - used
    if (remaining <= 0) throw new AgentRunQuotaExceededError('今日 Agent 成本额度已用尽')
    return {
      maxCost: Math.min(this.executionConfig.maxCostPerRun, remaining),
      costCurrency: 'CNY',
      dailyBudget: this.apiConfig.defaultDailyBudget,
      dailyUsedBeforeRun: used,
    }
  }

  private async resolvePublishedVersions(tx: Prisma.TransactionClient, pin: AgentWorkflowPin) {
    const workflow = await tx.aiWorkflowVersion.findFirst({
      where: {
        workflowKey: pin.workflowKey,
        version: pin.workflowVersion,
        contentHash: pin.workflowContentHash,
        status: AiVersionStatus.PUBLISHED,
      },
    })
    if (!workflow) throw new WorkflowVersionError('工作流版本不存在或未发布')
    const prompt = await tx.aiPromptVersion.findFirst({
      where: {
        promptKey: pin.promptKey,
        version: pin.promptVersion,
        contentHash: pin.promptContentHash,
        status: AiVersionStatus.PUBLISHED,
      },
    })
    if (!prompt) throw new WorkflowVersionError('Prompt 版本不存在或未发布', 6025)
    return { workflowVersionId: workflow.id, promptVersionId: prompt.id }
  }

  private resolvePreferredModel(modelPolicy: AiModelPolicy, conversation: AiConversation): string | null {
    if (modelPolicy === AiModelPolicy.AUTO) return null
    const preferredModel = conversation.preferredModel
    if (!preferredModel) throw new AgentMessageValidationError('MANUAL modelPolicy 需要会话先配置 preferredModel')
    try {
      this.models.get(preferredModel)
    } catch {
      throw new AgentMessageValidationError('preferredModel 未注册或不可用')
    }
    return preferredModel
  }

  private logOperation(operation: string, startedAt: number, runId: string): void {
    this.logger.log({ operation, durationMs: Date.now() - startedAt, runId }, AgentInteractionRepository.name)
  }
}

async function lockUser(tx: Prisma.TransactionClient, userId: number): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${BigInt(userId)})`)
}

async function findRunByRequest(tx: Prisma.TransactionClient, userId: number, clientRequestId: string) {
  return tx.aiAgentRun.findFirst({ where: { userId, clientRequestId } })
}

function resolveExisting(
  run: AiAgentRun,
  requestHash: string,
  sourceMessageId: string | null,
): CreatedAgentInteraction {
  if (run.requestHash !== requestHash) throw new AgentRunIdempotencyConflictError()
  return {
    conversationId: run.conversationId,
    triggerMessageId: run.triggerMessageId,
    responseMessageId: run.responseMessageId,
    sourceMessageId,
    run,
  }
}

function hashRequest(value: Record<string, unknown>): string {
  return sha256(canonicalJson(value as never))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
