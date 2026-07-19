import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable } from '@nestjs/common'
import { AiAgentRunStatus } from '@prisma/client'
import { AgentQueueService } from 'src/queue/agent/agent-queue.service'
import { RequestContextService } from 'src/shared/context/request-context.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import type { AgentCapability } from '../contracts'
import type {
  AgentRunStatusDto,
  CancelAgentRunDto,
  ListAgentToolCallsDto,
  RegenerateAgentMessageDto,
  SendAgentMessageDto,
} from '../api/dto/run/run-request.dto'
import { AgentRestReadRepository } from '../api/agent-rest-read.repository'
import { AgentRunRepository } from '../execution/agent-run.repository'
import { WorkflowRegistryService } from '../workflow/workflow-registry.service'
import { AgentInteractionRepository, type AgentWorkflowPin } from './agent-interaction.repository'

const STREAM_ENDPOINT = '/api/agent/runs/events' as const

@Injectable()
export class AgentRunService {
  constructor(
    private readonly interactions: AgentInteractionRepository,
    private readonly reads: AgentRestReadRepository,
    private readonly runs: AgentRunRepository,
    private readonly queue: AgentQueueService,
    private readonly registry: WorkflowRegistryService,
    private readonly logger: LoggerService,
  ) {}

  async send(userId: number, dto: SendAgentMessageDto) {
    validatePageContext(dto.pageContext)
    const allowedCapabilities = normalizeCapabilities(dto.allowedCapabilities)
    const interaction = await this.interactions.send({
      userId,
      clientRequestId: dto.clientRequestId,
      conversationId: dto.conversationId,
      content: dto.content,
      pageContext: dto.pageContext ? { ...dto.pageContext } : {},
      modelPolicy: dto.modelPolicy,
      allowedCapabilities,
      allowedScopes: resolveScopes(allowedCapabilities),
      traceId: RequestContextService.getTraceId() ?? randomUUID(),
      workflow: this.workflowPin(),
    })
    if (isActive(interaction.run.status)) await this.enqueueBestEffort(interaction.run.id)
    return {
      conversationId: interaction.conversationId,
      userMessageId: interaction.triggerMessageId,
      assistantMessageId: interaction.responseMessageId,
      runId: interaction.run.id,
      runStatus: interaction.run.status,
      streamEndpoint: STREAM_ENDPOINT,
    }
  }

  async regenerate(userId: number, dto: RegenerateAgentMessageDto) {
    const interaction = await this.interactions.regenerate({
      userId,
      clientRequestId: dto.clientRequestId,
      sourceMessageId: dto.messageId,
      modelPolicy: dto.modelPolicy,
      traceId: RequestContextService.getTraceId() ?? randomUUID(),
      workflow: this.workflowPin(),
    })
    if (isActive(interaction.run.status)) await this.enqueueBestEffort(interaction.run.id)
    return {
      conversationId: interaction.conversationId,
      sourceMessageId: dto.messageId,
      assistantMessageId: interaction.responseMessageId,
      runId: interaction.run.id,
      runStatus: interaction.run.status,
      streamEndpoint: STREAM_ENDPOINT,
    }
  }

  status(userId: number, dto: AgentRunStatusDto) {
    return this.reads.getRunStatus(userId, dto.runId)
  }

  async cancel(userId: number, dto: CancelAgentRunDto) {
    const run = await this.runs.requestCancel({
      userId,
      runId: dto.runId,
      expectedVersion: dto.expectedStatusVersion,
    })
    if (run.status === AiAgentRunStatus.CANCELLED) {
      try {
        await this.queue.removeWaitingRun(run.id)
      } catch (error) {
        this.logger.warn(
          { operation: 'agentApi.cancel.removeWaiting', runId: run.id, error: safeErrorMessage(error) },
          AgentRunService.name,
        )
      }
    }
    return {
      runId: run.id,
      status: run.status,
      statusVersion: run.statusVersion,
      cancellationAccepted: new Set<AiAgentRunStatus>([
        AiAgentRunStatus.CANCEL_REQUESTED,
        AiAgentRunStatus.CANCELLED,
      ]).has(run.status),
    }
  }

  async listToolCalls(userId: number, dto: ListAgentToolCallsDto) {
    const items = await this.reads.listToolCalls(userId, dto.runId)
    return { items, payloadIncluded: false as const }
  }

  private workflowPin(): AgentWorkflowPin {
    const snapshot = this.registry.snapshot('stock_research', 1)
    return {
      workflowKey: snapshot.workflowKey,
      workflowVersion: snapshot.version,
      workflowContentHash: snapshot.contentHash,
      promptKey: snapshot.prompt.promptKey,
      promptVersion: snapshot.prompt.version,
      promptContentHash: snapshot.prompt.contentHash,
    }
  }

  private async enqueueBestEffort(runId: string): Promise<void> {
    try {
      await this.queue.enqueueRun(runId)
    } catch (error) {
      this.logger.warn(
        { operation: 'agentApi.enqueue', runId, error: safeErrorMessage(error), recoverableByOutbox: true },
        AgentRunService.name,
      )
    }
  }
}

function normalizeCapabilities(values: AgentCapability[]): AgentCapability[] {
  const requested = new Set(values)
  return ['INTERNAL_DATA', 'QUANT_COMPUTE', 'WEB_SEARCH'].filter((value) =>
    requested.has(value as AgentCapability),
  ) as AgentCapability[]
}

function resolveScopes(capabilities: AgentCapability[]): string[] {
  const scopes = new Set<string>()
  if (capabilities.includes('INTERNAL_DATA')) {
    scopes.add('PUBLIC_MARKET_DATA')
    scopes.add('USER_PRIVATE')
  }
  if (capabilities.includes('QUANT_COMPUTE')) {
    scopes.add('QUANT_CALCULATION')
    scopes.add('USER_PRIVATE')
  }
  if (capabilities.includes('WEB_SEARCH')) scopes.add('PUBLIC_WEB')
  return [...scopes].sort()
}

function validatePageContext(context: SendAgentMessageDto['pageContext']): void {
  if (context && Boolean(context.entityType) !== Boolean(context.entityId)) {
    throw validationError('pageContext.entityType 与 entityId 必须同时提供')
  }
  if (!context?.selectedRange) return
  if (context.selectedRange.start > context.selectedRange.end) {
    throw validationError('pageContext.selectedRange.start 不能晚于 end')
  }
}

function validationError(message: string): BadRequestException {
  return new BadRequestException([message])
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, ' ').slice(0, 500)
}

function isActive(status: AiAgentRunStatus): boolean {
  return new Set<AiAgentRunStatus>([
    AiAgentRunStatus.QUEUED,
    AiAgentRunStatus.RUNNING,
    AiAgentRunStatus.CANCEL_REQUESTED,
  ]).has(status)
}
