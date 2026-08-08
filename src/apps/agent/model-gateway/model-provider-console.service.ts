import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, type AiModelConnection, type AiModelDeployment } from '@prisma/client'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import type { AgentModelCostTier, AgentModelProviderConfig, AgentModelProviderName } from 'src/config/model.config'
import { PrismaService } from 'src/shared/prisma.service'
import type {
  CreateModelConnectionDto,
  CreateModelDeploymentDto,
  ListModelConnectionsDto,
  ListModelDeploymentsDto,
  ProbeModelDeploymentDto,
  TestModelConnectionDto,
  UpdateModelConnectionDto,
  UpdateModelDeploymentDto,
} from '../api/dto/model/model-provider-console.dto'
import { MODEL_ADAPTER_DEFINITIONS, getModelAdapterDefinition } from './model-adapter.catalog'
import { createModelProvider } from './model-provider.factory'
import {
  ModelGatewayError,
  type ModelProvider,
  type ModelReasoningIntent,
  type ProviderModelRequest,
} from './model-gateway.port'

const REASONING_EFFORT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
const DEPLOYMENT_PROBE_SCHEMA = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean', const: true } },
  additionalProperties: false,
} as const
const DEPLOYMENT_PROBE_TOOL_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

interface SecretEnvelope {
  iv: string
  tag: string
  ciphertext: string
}

export interface ProbeStep {
  key: 'URL_POLICY' | 'TLS' | 'AUTH' | 'MODEL' | 'REASONING' | 'STRUCTURED_OUTPUT' | 'TOOLS' | 'VISION' | 'STREAM'
  status: 'PASSED' | 'FAILED' | 'SKIPPED'
  durationMs: number
  message: string
}

export interface UpdateModelDeploymentResult {
  deployment: ReturnType<typeof toDeploymentResponse>
  previousEnabled: boolean
  routingChanged: boolean
}

@Injectable()
export class ModelProviderConsoleService {
  constructor(private readonly prisma: PrismaService) {}

  listAdapters() {
    return { items: MODEL_ADAPTER_DEFINITIONS }
  }

  async listConnections(dto: ListModelConnectionsDto) {
    const where =
      dto.status === 'ENABLED'
        ? { enabled: true }
        : dto.status === 'DISABLED'
          ? { enabled: false }
          : dto.status === 'FAILED'
            ? { lastProbeStatus: 'FAILED' }
            : {}
    const rows = await this.prisma.aiModelConnection.findMany({
      where,
      include: { _count: { select: { deployments: true } } },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    })
    return { items: rows.map(toConnectionResponse) }
  }

  async createConnection(dto: CreateModelConnectionDto) {
    validateBaseUrl(dto.baseUrl)
    if (dto.enabled) throw new BadRequestException('新连接必须先保存草稿并通过连接测试后才能启用')
    try {
      const row = await this.prisma.aiModelConnection.create({
        data: {
          id: randomUUID(),
          connectionKey: dto.connectionKey,
          adapterKind: dto.adapterKind,
          displayName: dto.displayName,
          baseUrl: normalizeBaseUrl(dto.baseUrl),
          encryptedApiKey: encryptSecret(dto.apiKey),
          apiKeyLastFour: lastFour(dto.apiKey),
          enabled: false,
        },
        include: { _count: { select: { deployments: true } } },
      })
      return toConnectionResponse(row)
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictException('connectionKey 已存在')
      throw error
    }
  }

  async updateConnection(dto: UpdateModelConnectionDto) {
    const current = await this.findConnection(dto.id)
    if (dto.baseUrl) validateBaseUrl(dto.baseUrl)
    const invalidatesProbe = connectionUpdateInvalidatesProbe(dto, current)
    if (invalidatesProbe && dto.enabled === true) {
      throw new BadRequestException('连接参数变更后必须重新测试，不能同时启用')
    }
    if (dto.enabled === true && current.lastProbeStatus !== 'PASSED') {
      throw new BadRequestException('连接测试通过后才能启用')
    }
    const data = {
      ...(dto.connectionKey === undefined ? {} : { connectionKey: dto.connectionKey }),
      ...(dto.adapterKind === undefined ? {} : { adapterKind: dto.adapterKind }),
      ...(dto.displayName === undefined ? {} : { displayName: dto.displayName }),
      ...(dto.baseUrl === undefined ? {} : { baseUrl: normalizeBaseUrl(dto.baseUrl) }),
      ...(dto.apiKey === undefined
        ? {}
        : { encryptedApiKey: encryptSecret(dto.apiKey), apiKeyLastFour: lastFour(dto.apiKey) }),
      ...(invalidatesProbe ? { enabled: false } : dto.enabled === undefined ? {} : { enabled: dto.enabled }),
      ...(invalidatesProbe
        ? { lastProbeStatus: null, lastProbeAt: null, lastProbeDurationMs: null, lastProbeSteps: Prisma.JsonNull }
        : {}),
      configVersion: { increment: 1 },
    }
    const updated = await this.prisma.aiModelConnection.updateMany({
      where: { id: dto.id, configVersion: dto.version },
      data,
    })
    if (updated.count !== 1) throw new ConflictException('连接配置已被其他管理员更新，请刷新后重试')
    if (invalidatesProbe) {
      await this.prisma.aiModelDeployment.updateMany({
        where: { connectionId: dto.id },
        data: { enabled: false, lastProbeStatus: null, lastProbeAt: null, lastProbeDurationMs: null },
      })
    }
    const row = await this.prisma.aiModelConnection.findUniqueOrThrow({
      where: { id: dto.id },
      include: { _count: { select: { deployments: true } } },
    })
    return toConnectionResponse(row)
  }

  async testConnection(dto: TestModelConnectionDto) {
    const connection = await this.findConnection(dto.id)
    const startedAt = Date.now()
    const steps: ProbeStep[] = []
    const push = (key: ProbeStep['key'], status: ProbeStep['status'], message: string, at: number) =>
      steps.push({ key, status, message, durationMs: Date.now() - at })
    try {
      const urlStartedAt = Date.now()
      validateBaseUrl(connection.baseUrl)
      push('URL_POLICY', 'PASSED', 'URL 与部署安全策略匹配', urlStartedAt)
      const authStartedAt = Date.now()
      const response = await fetch(`${connection.baseUrl.replace(/\/$/, '')}/models`, {
        method: 'GET',
        headers: connectionHeaders(connection.adapterKind, decryptSecret(connection.encryptedApiKey)),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        push('AUTH', 'FAILED', publicProbeHttpMessage(response.status), authStartedAt)
        throw new ModelGatewayError(
          response.status === 401 || response.status === 403 ? 'AUTH' : 'UNAVAILABLE',
          false,
          '连接测试失败',
        )
      }
      void response.body?.cancel().catch(() => undefined)
      push(
        'TLS',
        'PASSED',
        new URL(connection.baseUrl).protocol === 'https:' ? 'TLS 握手成功' : '本地 HTTP 测试连接',
        authStartedAt,
      )
      push('AUTH', 'PASSED', '凭证有效且模型目录可访问', authStartedAt)
      return await this.saveConnectionProbe(connection.id, 'PASSED', startedAt, steps)
    } catch (error) {
      if (!steps.some((step) => step.status === 'FAILED')) {
        push('AUTH', 'FAILED', publicProbeError(error), startedAt)
      }
      return this.saveConnectionProbe(connection.id, 'FAILED', startedAt, steps)
    }
  }

  async connectionDeleteImpact(id: string) {
    const connection = await this.findConnection(id)
    const deployments = await this.prisma.aiModelDeployment.findMany({
      where: { connectionId: id },
      select: { id: true, displayName: true, enabled: true },
      orderBy: { priority: 'asc' },
    })
    return {
      id: connection.id,
      canDelete: deployments.length === 0,
      deployments,
      message: deployments.length ? '请先删除此连接下的模型部署' : '此连接没有模型部署，可以安全删除',
    }
  }

  async deleteConnection(id: string) {
    const impact = await this.connectionDeleteImpact(id)
    if (!impact.canDelete) throw new BadRequestException(impact.message)
    await this.prisma.aiModelConnection.delete({ where: { id } })
    return { id, deleted: true }
  }

  async listDeployments(dto: ListModelDeploymentsDto) {
    const rows = await this.prisma.aiModelDeployment.findMany({
      where: dto.connectionId ? { connectionId: dto.connectionId } : {},
      include: { connection: true },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
    return { items: rows.map(toDeploymentResponse) }
  }

  async createDeployment(dto: CreateModelDeploymentDto) {
    const connection = await this.findConnection(dto.connectionId)
    validateDeployment(dto, connection.adapterKind)
    if (dto.enabled) throw new BadRequestException('新部署必须先保存草稿并通过深度探测后才能启用')
    try {
      const row = await this.prisma.aiModelDeployment.create({
        data: {
          id: randomUUID(),
          ...deploymentWriteData(dto),
          enabled: false,
        } as Prisma.AiModelDeploymentUncheckedCreateInput,
        include: { connection: true },
      })
      return toDeploymentResponse(row)
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictException('同一连接下的 modelId 已存在')
      throw error
    }
  }

  async updateDeployment(dto: UpdateModelDeploymentDto): Promise<UpdateModelDeploymentResult> {
    const current = await this.findDeployment(dto.id)
    const connection = await this.findConnection(dto.connectionId ?? current.connectionId)
    const merged = { ...current, ...dto }
    validateDeployment(
      {
        ...merged,
        reasoningMode: merged.reasoningMode as CreateModelDeploymentDto['reasoningMode'],
      },
      connection.adapterKind,
    )
    if (dto.enabled === true) {
      if (!connection.enabled || connection.lastProbeStatus !== 'PASSED') {
        throw new BadRequestException('所属连接需启用且测试通过后才能启用模型部署')
      }
      if (current.lastProbeStatus !== 'PASSED') throw new BadRequestException('模型深度探测通过后才能启用')
    }
    const data = deploymentWriteData(dto)
    const updated = await this.prisma.aiModelDeployment.updateMany({
      where: { id: dto.id, configVersion: dto.version },
      data: { ...data, configVersion: { increment: 1 } },
    })
    if (updated.count !== 1) throw new ConflictException('模型配置已被其他管理员更新，请刷新后重试')
    const row = await this.prisma.aiModelDeployment.findUniqueOrThrow({
      where: { id: dto.id },
      include: { connection: true },
    })
    return {
      deployment: toDeploymentResponse(row),
      previousEnabled: current.enabled,
      routingChanged: dto.enabled !== undefined && dto.enabled !== current.enabled,
    }
  }

  async restoreDeploymentEnabled(id: string, version: number, enabled: boolean) {
    const restored = await this.prisma.aiModelDeployment.updateMany({
      where: { id, configVersion: version },
      data: { enabled, configVersion: { increment: 1 } },
    })
    if (restored.count !== 1) throw new ConflictException('模型配置已被其他管理员更新，无法回滚启用状态')
  }

  async probeDeployment(dto: ProbeModelDeploymentDto) {
    if (!dto.confirmBillable) {
      throw new BadRequestException('深度探测会根据能力声明产生一至两次最小模型调用，请确认后继续')
    }
    const row = await this.prisma.aiModelDeployment.findUnique({ where: { id: dto.id }, include: { connection: true } })
    if (!row) throw new NotFoundException('模型部署不存在')
    if (row.connection.lastProbeStatus !== 'PASSED') throw new BadRequestException('请先通过连接测试')
    const startedAt = Date.now()
    const steps: ProbeStep[] = [{ key: 'AUTH', status: 'PASSED', durationMs: 0, message: '复用最近一次连接测试结果' }]
    let providerRequestId: string | null = null
    let currentStep: ProbeStep['key'] = 'MODEL'
    try {
      const provider = createModelProvider(toRuntimeConfig(row))
      const primary = await executeDeploymentProbe(provider, primaryProbeRequest(row), probeTimeoutMs(row))
      providerRequestId = primary.providerRequestId
      assertPrimaryProbeOutput(row, primary.outputText)
      steps.push({
        key: 'MODEL',
        status: 'PASSED',
        durationMs: Date.now() - startedAt,
        message: `模型接受当前部署参数，最大输出上限 ${row.maxOutputTokens}`,
      })
      if (row.reasoningMode !== 'AUTO') {
        steps.push({
          key: 'REASONING',
          status: 'PASSED',
          durationMs: Date.now() - startedAt,
          message: `默认推理策略 ${reasoningIntentLabel(row)} 可用`,
        })
      }
      if (row.capabilities.includes('STRUCTURED_OUTPUT')) {
        steps.push({
          key: 'STRUCTURED_OUTPUT',
          status: 'PASSED',
          durationMs: Date.now() - startedAt,
          message: '严格结构化输出已返回并通过最小 Schema 校验',
        })
      }

      if (requiresToolProbe(row)) {
        currentStep = 'TOOLS'
        const toolResult = await executeDeploymentProbe(provider, toolProbeRequest(row), probeTimeoutMs(row))
        providerRequestId = toolResult.providerRequestId ?? providerRequestId
        assertToolProbeOutput(row, toolResult.toolNames)
        steps.push({
          key: 'TOOLS',
          status: 'PASSED',
          durationMs: Date.now() - startedAt,
          message: row.capabilities.includes('PARALLEL_TOOL_CALLING')
            ? '工具调用与并行工具参数已验证'
            : '工具调用参数与返回格式已验证',
        })
      }
      if (row.capabilities.includes('VISION')) {
        steps.push({
          key: 'VISION',
          status: 'SKIPPED',
          durationMs: Date.now() - startedAt,
          message: '当前统一消息协议尚未提供图片探测载荷；保留管理员声明，由真实视觉调用验证',
        })
      }
      steps.push({
        key: 'STREAM',
        status: 'PASSED',
        durationMs: Date.now() - startedAt,
        message: '全部探测请求均收到完整流式结束事件',
      })
      return this.saveDeploymentProbe(row.id, 'PASSED', startedAt, steps, providerRequestId)
    } catch (error) {
      const message = publicProbeError(error)
      steps.push({
        key: probeFailureStep(currentStep, message),
        status: 'FAILED',
        durationMs: Date.now() - startedAt,
        message,
      })
      return this.saveDeploymentProbe(row.id, 'FAILED', startedAt, steps, providerRequestId)
    }
  }

  async deploymentDeleteImpact(id: string) {
    const row = await this.findDeployment(id)
    const activeVersion = await this.prisma.aiModelConfigVersion.findFirst({
      where: { status: 'ACTIVE', deploymentIds: { has: id } },
      select: { id: true },
    })
    const canDelete = !row.enabled && !activeVersion
    const message = row.enabled
      ? '请先停用模型部署并发布路由版本'
      : activeVersion
        ? `部署仍被活动版本 ${activeVersion.id} 引用，请先发布不包含它的新版本`
        : '部署已退出活动路由，可以删除'
    return {
      id,
      canDelete,
      activeReferences: [
        ...(row.enabled ? [{ type: 'DRAFT_ROUTE', label: row.displayName }] : []),
        ...(activeVersion ? [{ type: 'ACTIVE_VERSION', label: activeVersion.id }] : []),
      ],
      message,
    }
  }

  async deleteDeployment(id: string) {
    const impact = await this.deploymentDeleteImpact(id)
    if (!impact.canDelete) throw new BadRequestException(impact.message)
    await this.prisma.aiModelDeployment.delete({ where: { id } })
    return { id, deleted: true }
  }

  async createPublishedVersion() {
    const deployments = await this.prisma.aiModelDeployment.findMany({
      where: { enabled: true, connection: { enabled: true } },
      include: { connection: true },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
    if (deployments.length === 0) throw new BadRequestException('至少需要一个已启用模型部署才能发布')
    const invalid = deployments.find(
      (item) => item.lastProbeStatus !== 'PASSED' || item.connection.lastProbeStatus !== 'PASSED',
    )
    if (invalid) throw new BadRequestException(`部署 ${invalid.displayName} 或所属连接尚未通过探测`)
    const id = `modelcfg_${Date.now()}_${randomUUID().slice(0, 8)}`
    const snapshot = deployments.map((item) => ({
      deploymentId: item.id,
      connectionId: item.connectionId,
      connectionKey: item.connection.connectionKey,
      adapterKind: item.connection.adapterKind,
      baseUrl: item.connection.baseUrl,
      encryptedApiKey: item.connection.encryptedApiKey,
      modelId: item.modelId,
      displayName: item.displayName,
      priority: item.priority,
      costTier: item.costTier,
      contextWindow: item.contextWindow,
      maxOutputTokens: item.maxOutputTokens,
      capabilities: item.capabilities,
      reasoningMode: item.reasoningMode,
      reasoningEfforts: item.reasoningEfforts,
      defaultReasoningEffort: item.defaultReasoningEffort,
      reasoningBudgetTokens: item.reasoningBudgetTokens,
      dataClasses: item.dataClasses,
      timeoutMs: item.timeoutMs,
      maxRetries: item.maxRetries,
      retryBaseMs: item.retryBaseMs,
    }))
    const activeVersion = await this.prisma.aiModelConfigVersion.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: { snapshot: true },
    })
    const migrations = resolveModelIdMigrations(activeVersion?.snapshot, snapshot)
    const nextModelIds = new Set(snapshot.map((item) => item.modelId))
    const [conversationReferences, scheduleReferences] = await Promise.all([
      this.prisma.aiConversation.findMany({
        where: { modelPolicy: 'MANUAL', preferredModel: { not: null }, status: { not: 'DELETED' } },
        select: { preferredModel: true },
      }),
      this.prisma.aiScheduledTask.findMany({
        where: { modelPolicy: 'MANUAL', preferredModel: { not: null }, status: { not: 'DELETED' } },
        select: { preferredModel: true },
      }),
    ])
    const unavailableModels = unavailableReferencedModels(
      [...conversationReferences, ...scheduleReferences],
      nextModelIds,
      migrations,
    )
    if (unavailableModels.length > 0) {
      throw new BadRequestException(
        `活动版本缺少仍被会话或定时任务引用的模型：${unavailableModels.join('、')}；请重新启用这些模型，或先切换相关引用`,
      )
    }
    const referenceMigrations = [...migrations].flatMap(([from, to]) => [
      this.prisma.aiConversation.updateMany({
        where: { modelPolicy: 'MANUAL', preferredModel: from, status: { not: 'DELETED' } },
        data: { preferredModel: to },
      }),
      this.prisma.aiScheduledTask.updateMany({
        where: { modelPolicy: 'MANUAL', preferredModel: from, status: { not: 'DELETED' } },
        data: { preferredModel: to },
      }),
    ])
    await this.prisma.$transaction([
      this.prisma.aiModelConfigVersion.updateMany({ where: { status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } }),
      ...referenceMigrations,
      this.prisma.aiModelConfigVersion.create({
        data: {
          id,
          status: 'ACTIVE',
          deploymentIds: deployments.map((item) => item.id),
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
      }),
    ])
    return { activeVersion: id, deployments: deployments.map((item) => item.id) }
  }

  async assertPublishable(): Promise<void> {
    const deployments = await this.prisma.aiModelDeployment.findMany({
      where: { enabled: true, connection: { enabled: true } },
      include: { connection: true },
    })
    if (deployments.length === 0) throw new BadRequestException('至少需要一个已启用模型部署才能发布')
    const invalid = deployments.find(
      (item) => item.lastProbeStatus !== 'PASSED' || item.connection.lastProbeStatus !== 'PASSED',
    )
    if (invalid) throw new BadRequestException(`部署 ${invalid.displayName} 或所属连接尚未通过探测`)
  }

  async consoleSummary() {
    const [connections, deployments, activeVersion] = await Promise.all([
      this.prisma.aiModelConnection.findMany({ select: { enabled: true, lastProbeStatus: true } }),
      this.prisma.aiModelDeployment.findMany({ select: { enabled: true, lastProbeStatus: true } }),
      this.prisma.aiModelConfigVersion.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'desc' } }),
    ])
    return {
      activeDeployments: activeVersion?.deploymentIds.length ?? 0,
      verifiedConnections: connections.filter((item) => item.enabled && item.lastProbeStatus === 'PASSED').length,
      failedProbes:
        connections.filter((item) => item.lastProbeStatus === 'FAILED').length +
        deployments.filter((item) => item.lastProbeStatus === 'FAILED').length,
      configurationIssues:
        connections.filter((item) => item.enabled && item.lastProbeStatus !== 'PASSED').length +
        deployments.filter((item) => item.enabled && item.lastProbeStatus !== 'PASSED').length,
      activeVersion: activeVersion?.id ?? null,
    }
  }

  private async saveConnectionProbe(id: string, status: string, startedAt: number, steps: ProbeStep[]) {
    const durationMs = Date.now() - startedAt
    const at = new Date()
    await this.prisma.$transaction([
      this.prisma.aiModelConnection.update({
        where: { id },
        data: {
          lastProbeStatus: status,
          lastProbeAt: at,
          lastProbeDurationMs: durationMs,
          lastProbeSteps: steps as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.aiModelProbe.create({
        data: {
          id: randomUUID(),
          targetType: 'CONNECTION',
          targetId: id,
          level: 'AUTH',
          status,
          durationMs,
          steps: steps as unknown as Prisma.InputJsonValue,
        },
      }),
    ])
    return { id, status, durationMs, checkedAt: at.toISOString(), steps }
  }

  private async saveDeploymentProbe(
    id: string,
    status: string,
    startedAt: number,
    steps: ProbeStep[],
    providerRequestId: string | null,
  ) {
    const durationMs = Date.now() - startedAt
    const at = new Date()
    await this.prisma.$transaction([
      this.prisma.aiModelDeployment.update({
        where: { id },
        data: { lastProbeStatus: status, lastProbeAt: at, lastProbeDurationMs: durationMs },
      }),
      this.prisma.aiModelProbe.create({
        data: {
          id: randomUUID(),
          targetType: 'DEPLOYMENT',
          targetId: id,
          level: 'STREAM',
          status,
          durationMs,
          steps: steps as unknown as Prisma.InputJsonValue,
          providerRequestId,
        },
      }),
    ])
    return { id, status, durationMs, checkedAt: at.toISOString(), steps, providerRequestId }
  }

  private async findConnection(id: string) {
    const row = await this.prisma.aiModelConnection.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('模型连接不存在')
    return row
  }

  private async findDeployment(id: string) {
    const row = await this.prisma.aiModelDeployment.findUnique({ where: { id } })
    if (!row) throw new NotFoundException('模型部署不存在')
    return row
  }
}

interface DeploymentProbeExecution {
  outputText: string
  toolNames: string[]
  providerRequestId: string | null
}

async function executeDeploymentProbe(
  provider: ModelProvider,
  request: ProviderModelRequest,
  timeoutMs: number,
): Promise<DeploymentProbeExecution> {
  let outputText = ''
  const toolNames: string[] = []
  let providerRequestId: string | null = null
  let completed = false
  for await (const chunk of provider.stream(request, AbortSignal.timeout(timeoutMs))) {
    if (chunk.type === 'OUTPUT_TEXT_DELTA') outputText += chunk.text
    if (chunk.type === 'TOOL_CALL_COMPLETED') toolNames.push(chunk.name)
    if (chunk.type === 'COMPLETED') {
      providerRequestId = chunk.providerRequestId ?? null
      completed = true
    }
  }
  if (!completed) throw new ModelGatewayError('INVALID_OUTPUT', false, '探测响应缺少完整流式结束事件')
  return { outputText, toolNames, providerRequestId }
}

function primaryProbeRequest(row: DeploymentWithConnection): ProviderModelRequest {
  const structuredOutput = row.capabilities.includes('STRUCTURED_OUTPUT')
  return {
    ...deploymentProbeRequestBase(row, 'profile'),
    messages: [
      {
        role: 'user',
        content: structuredOutput ? 'Return the JSON object {"ok":true} and nothing else.' : 'Reply with OK.',
      },
    ],
    ...(structuredOutput ? { responseSchema: DEPLOYMENT_PROBE_SCHEMA } : {}),
  }
}

function toolProbeRequest(row: DeploymentWithConnection): ProviderModelRequest {
  const parallel = row.capabilities.includes('PARALLEL_TOOL_CALLING')
  const toolNames = parallel ? ['probe_alpha', 'probe_beta'] : ['probe_tool']
  return {
    ...deploymentProbeRequestBase(row, 'tools'),
    messages: [
      {
        role: 'user',
        content: `Call ${toolNames.join(' and ')} exactly once with an empty JSON object. Do not answer with text.`,
      },
    ],
    tools: toolNames.map((name) => ({
      name,
      description: 'Minimal deployment compatibility probe. Returns no business data.',
      parameters: DEPLOYMENT_PROBE_TOOL_SCHEMA,
    })),
    metadata: { parallelToolCalls: parallel },
  }
}

function deploymentProbeRequestBase(row: DeploymentWithConnection, suffix: string): ProviderModelRequest {
  const probeId = `probe_${row.id}_${suffix}`
  return {
    model: row.modelId,
    modelPolicy: 'MANUAL',
    preferredModel: row.modelId,
    purpose: 'VERIFY',
    messages: [],
    reasoning: reasoningIntent(row),
    maxOutputTokens: row.maxOutputTokens,
    deadlineAt: new Date(Date.now() + probeTimeoutMs(row)).toISOString(),
    dataClass: 'PUBLIC',
    trace: { runId: probeId, modelCallId: probeId, traceId: probeId },
  }
}

function assertPrimaryProbeOutput(row: DeploymentWithConnection, outputText: string): void {
  if (!row.capabilities.includes('STRUCTURED_OUTPUT')) {
    if (!outputText.trim()) throw new ModelGatewayError('INVALID_OUTPUT', false, '模型探测未返回文本内容')
    return
  }
  let value: unknown
  try {
    value = JSON.parse(outputText)
  } catch {
    throw new ModelGatewayError('INVALID_OUTPUT', false, '结构化输出探测返回的内容不是有效 JSON')
  }
  if (!value || Array.isArray(value) || typeof value !== 'object' || (value as { ok?: unknown }).ok !== true) {
    throw new ModelGatewayError('INVALID_OUTPUT', false, '结构化输出探测未满足最小 Schema')
  }
}

function assertToolProbeOutput(row: DeploymentWithConnection, actualToolNames: string[]): void {
  const expected = row.capabilities.includes('PARALLEL_TOOL_CALLING') ? ['probe_alpha', 'probe_beta'] : ['probe_tool']
  const actual = new Set(actualToolNames)
  if (expected.some((name) => !actual.has(name))) {
    throw new ModelGatewayError(
      'INVALID_OUTPUT',
      false,
      row.capabilities.includes('PARALLEL_TOOL_CALLING')
        ? '并行工具探测未返回两个完整工具调用'
        : '工具调用探测未返回完整工具调用',
    )
  }
}

function requiresToolProbe(row: DeploymentWithConnection): boolean {
  return row.capabilities.includes('TOOL_CALLING') || row.capabilities.includes('PARALLEL_TOOL_CALLING')
}

function probeFailureStep(fallback: ProbeStep['key'], message: string): ProbeStep['key'] {
  const normalized = message.toLowerCase()
  if (normalized.includes('推理') || normalized.includes('reasoning')) return 'REASONING'
  if (normalized.includes('结构化') || normalized.includes('response_format') || normalized.includes('schema')) {
    return 'STRUCTURED_OUTPUT'
  }
  if (normalized.includes('工具') || normalized.includes('tool')) return 'TOOLS'
  if (normalized.includes('视觉') || normalized.includes('vision')) return 'VISION'
  return fallback
}

function probeTimeoutMs(row: AiModelDeployment): number {
  return Math.min(row.timeoutMs, 60_000)
}

function reasoningIntentLabel(row: AiModelDeployment): string {
  const intent = reasoningIntent(row)
  if (intent.mode === 'EFFORT') return `EFFORT:${intent.effort}`
  if (intent.mode === 'TOKEN_BUDGET') return `TOKEN_BUDGET:${intent.budgetTokens}`
  return intent.mode
}

type ModelSnapshotReference = {
  deploymentId: string
  modelId: string
}

function resolveModelIdMigrations(
  previousSnapshot: unknown,
  nextSnapshot: ModelSnapshotReference[],
): Map<string, string> {
  const previous = modelSnapshotReferences(previousSnapshot)
  const nextByDeployment = new Map(nextSnapshot.map((item) => [item.deploymentId, item.modelId]))
  const nextModelIds = new Set(nextSnapshot.map((item) => item.modelId))
  const candidates = new Map<string, Set<string>>()
  for (const item of previous) {
    const nextModelId = nextByDeployment.get(item.deploymentId)
    if (!nextModelId || nextModelId === item.modelId || nextModelIds.has(item.modelId)) continue
    const replacements = candidates.get(item.modelId) ?? new Set<string>()
    replacements.add(nextModelId)
    candidates.set(item.modelId, replacements)
  }
  return new Map(
    [...candidates]
      .filter(([, replacements]) => replacements.size === 1)
      .map(([modelId, replacements]) => [modelId, [...replacements][0]]),
  )
}

function modelSnapshotReferences(value: unknown): ModelSnapshotReference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const deploymentId = (item as Record<string, unknown>).deploymentId
    const modelId = (item as Record<string, unknown>).modelId
    return typeof deploymentId === 'string' && typeof modelId === 'string' ? [{ deploymentId, modelId }] : []
  })
}

function unavailableReferencedModels(
  references: { preferredModel: string | null }[],
  nextModelIds: Set<string>,
  migrations: Map<string, string>,
): string[] {
  return [
    ...new Set(
      references.flatMap(({ preferredModel }) => {
        if (!preferredModel) return []
        const resolved = migrations.get(preferredModel) ?? preferredModel
        return nextModelIds.has(resolved) ? [] : [preferredModel]
      }),
    ),
  ].sort()
}

function validateDeployment(
  dto: Pick<
    CreateModelDeploymentDto,
    | 'capabilities'
    | 'reasoningMode'
    | 'reasoningEfforts'
    | 'defaultReasoningEffort'
    | 'reasoningBudgetTokens'
    | 'dataClasses'
    | 'maxOutputTokens'
  >,
  adapterKind: string,
): void {
  const adapter = getModelAdapterDefinition(adapterKind)
  if (!dto.capabilities.includes('STREAMING')) throw new BadRequestException('capabilities 必须包含 STREAMING')
  if (!adapter.reasoningModes.includes(dto.reasoningMode)) {
    throw new BadRequestException(`当前适配器不支持 ${dto.reasoningMode} 推理模式`)
  }
  if (dto.reasoningEfforts.some((item) => !REASONING_EFFORT_PATTERN.test(item))) {
    throw new BadRequestException('reasoningEfforts 包含非法档位')
  }
  if (dto.reasoningMode === 'EFFORT') {
    if (!dto.defaultReasoningEffort) throw new BadRequestException('EFFORT 模式必须设置默认推理档位')
    if (!includesIgnoreCase(dto.reasoningEfforts, dto.defaultReasoningEffort)) {
      throw new BadRequestException('默认推理档位必须包含在支持档位中')
    }
  }
  if (dto.reasoningMode === 'TOKEN_BUDGET' && !dto.reasoningBudgetTokens) {
    throw new BadRequestException('TOKEN_BUDGET 模式必须设置 reasoningBudgetTokens')
  }
  if (dto.reasoningBudgetTokens && dto.reasoningBudgetTokens >= dto.maxOutputTokens) {
    throw new BadRequestException('reasoningBudgetTokens 必须小于 maxOutputTokens')
  }
  if (!dto.dataClasses.length) throw new BadRequestException('至少选择一个允许处理的数据分类')
}

function connectionUpdateInvalidatesProbe(dto: UpdateModelConnectionDto, current: AiModelConnection): boolean {
  return (
    (dto.adapterKind !== undefined && dto.adapterKind !== current.adapterKind) ||
    (dto.baseUrl !== undefined && normalizeBaseUrl(dto.baseUrl) !== current.baseUrl) ||
    dto.apiKey !== undefined
  )
}

function deploymentWriteData(dto: Partial<CreateModelDeploymentDto>) {
  return {
    ...(dto.connectionId === undefined ? {} : { connectionId: dto.connectionId }),
    ...(dto.modelId === undefined ? {} : { modelId: dto.modelId }),
    ...(dto.displayName === undefined ? {} : { displayName: dto.displayName }),
    ...(dto.priority === undefined ? {} : { priority: dto.priority }),
    ...(dto.costTier === undefined ? {} : { costTier: dto.costTier }),
    ...(dto.contextWindow === undefined ? {} : { contextWindow: dto.contextWindow }),
    ...(dto.maxOutputTokens === undefined ? {} : { maxOutputTokens: dto.maxOutputTokens }),
    ...(dto.capabilities === undefined ? {} : { capabilities: dto.capabilities }),
    ...(dto.reasoningMode === undefined ? {} : { reasoningMode: dto.reasoningMode }),
    ...(dto.reasoningEfforts === undefined ? {} : { reasoningEfforts: dto.reasoningEfforts }),
    ...(dto.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: dto.defaultReasoningEffort }),
    ...(dto.reasoningBudgetTokens === undefined ? {} : { reasoningBudgetTokens: dto.reasoningBudgetTokens }),
    ...(dto.dataClasses === undefined ? {} : { dataClasses: dto.dataClasses }),
    ...(dto.timeoutMs === undefined ? {} : { timeoutMs: dto.timeoutMs }),
    ...(dto.maxRetries === undefined ? {} : { maxRetries: dto.maxRetries }),
    ...(dto.retryBaseMs === undefined ? {} : { retryBaseMs: dto.retryBaseMs }),
    ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }),
  }
}

type ConnectionWithCount = AiModelConnection & { _count?: { deployments: number } }
type DeploymentWithConnection = AiModelDeployment & { connection: AiModelConnection }

function toConnectionResponse(row: ConnectionWithCount) {
  return {
    id: row.id,
    connectionKey: row.connectionKey,
    adapterKind: row.adapterKind,
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    apiKeyConfigured: !!row.encryptedApiKey,
    apiKeyLastFour: row.apiKeyLastFour,
    enabled: row.enabled,
    version: row.configVersion,
    deploymentCount: row._count?.deployments ?? 0,
    lastProbe: row.lastProbeStatus
      ? {
          status: row.lastProbeStatus,
          checkedAt: row.lastProbeAt?.toISOString() ?? null,
          durationMs: row.lastProbeDurationMs,
          steps: row.lastProbeSteps ?? [],
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toDeploymentResponse(row: DeploymentWithConnection) {
  return {
    id: row.id,
    connectionId: row.connectionId,
    connectionKey: row.connection.connectionKey,
    connectionName: row.connection.displayName,
    adapterKind: row.connection.adapterKind,
    modelId: row.modelId,
    displayName: row.displayName,
    priority: row.priority,
    costTier: row.costTier as AgentModelCostTier,
    contextWindow: row.contextWindow,
    maxOutputTokens: row.maxOutputTokens,
    capabilities: row.capabilities,
    reasoningMode: row.reasoningMode,
    reasoningEfforts: row.reasoningEfforts,
    defaultReasoningEffort: row.defaultReasoningEffort,
    reasoningBudgetTokens: row.reasoningBudgetTokens,
    dataClasses: row.dataClasses,
    timeoutMs: row.timeoutMs,
    maxRetries: row.maxRetries,
    retryBaseMs: row.retryBaseMs,
    enabled: row.enabled,
    version: row.configVersion,
    lastProbe: row.lastProbeStatus
      ? {
          status: row.lastProbeStatus,
          checkedAt: row.lastProbeAt?.toISOString() ?? null,
          durationMs: row.lastProbeDurationMs,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toRuntimeConfig(row: DeploymentWithConnection): AgentModelProviderConfig {
  const defaultReasoning = reasoningIntent(row)
  return {
    id: row.id,
    kind: row.connection.adapterKind as AgentModelProviderName,
    displayName: row.displayName,
    defaultModel: row.modelId,
    priority: row.priority,
    costTier: row.costTier as AgentModelCostTier,
    baseUrl: row.connection.baseUrl,
    apiKey: decryptSecret(row.connection.encryptedApiKey),
    timeoutMs: row.timeoutMs,
    maxRetries: row.maxRetries,
    retryBaseMs: row.retryBaseMs,
    descriptor: {
      contextWindow: row.contextWindow,
      maxOutputTokens: row.maxOutputTokens,
      capabilities: row.capabilities,
      reasoningEfforts: row.reasoningEfforts,
      defaultReasoning,
      dataClasses: row.dataClasses,
    },
  }
}

function reasoningIntent(row: AiModelDeployment): ModelReasoningIntent {
  if (row.reasoningMode === 'DISABLED') return { mode: 'DISABLED' }
  if (row.reasoningMode === 'EFFORT') return { mode: 'EFFORT', effort: row.defaultReasoningEffort }
  if (row.reasoningMode === 'TOKEN_BUDGET') {
    return {
      mode: 'TOKEN_BUDGET',
      budgetTokens: row.reasoningBudgetTokens,
      ...(row.defaultReasoningEffort ? { effort: row.defaultReasoningEffort } : {}),
    }
  }
  return { mode: 'AUTO' }
}

function connectionHeaders(adapterKind: string, apiKey: string | null): Record<string, string> {
  if (!apiKey) throw new BadRequestException('连接未配置 API key')
  return adapterKind === 'anthropic-messages'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${apiKey}` }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, '')
}

function validateBaseUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new BadRequestException('baseUrl 必须是有效 URL')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash) {
    throw new BadRequestException('baseUrl 禁止 userinfo、query 与 fragment')
  }
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && loopback)) {
    throw new BadRequestException('仅允许 HTTPS；本地开发可使用 loopback HTTP')
  }
  if (process.env.NODE_ENV === 'production') {
    const origins = (process.env.AGENT_MODEL_BASE_URL_ALLOWLIST ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .flatMap((item) => {
        try {
          return [new URL(item).origin]
        } catch {
          return []
        }
      })
    if (!origins.includes(url.origin)) throw new BadRequestException('baseUrl 未命中生产环境 allowlist')
  }
}

function encryptSecret(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  } satisfies SecretEnvelope)
}

function decryptSecret(value: string | null): string | null {
  if (!value) return null
  try {
    const envelope = JSON.parse(value) as SecretEnvelope
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString(
      'utf8',
    )
  } catch {
    throw new Error('[AgentModel] provider apiKey 无法解密')
  }
}

function encryptionKey(): Buffer {
  const raw = process.env.AGENT_MODEL_DB_ENCRYPTION_KEY?.trim()
  if (!raw || raw.length < 32) {
    throw new Error('[AgentModel] AGENT_MODEL_DB_ENCRYPTION_KEY 必须为至少 32 字符的独立随机密钥')
  }
  return createHash('sha256').update(raw, 'utf8').digest()
}

function lastFour(value: string): string {
  return value.slice(-4).padStart(4, '*')
}

function includesIgnoreCase(items: string[], value: string): boolean {
  const normalized = value.toLowerCase()
  return items.some((item) => item.toLowerCase() === normalized)
}

function publicProbeHttpMessage(status: number): string {
  if (status === 401 || status === 403) return '鉴权失败，请检查 API key'
  if (status === 404) return '模型目录端点不存在，请检查 Base URL'
  if (status === 429) return '供应商限流，请稍后重试'
  return `供应商返回 HTTP ${status}`
}

function publicProbeError(error: unknown): string {
  if (error instanceof ModelGatewayError) return error.message
  if (error instanceof BadRequestException) return error.message
  if (error instanceof Error && error.name === 'TimeoutError') {
    return '探测超时（单次最多等待 60 秒），请检查上游状态或调整模型超时配置'
  }
  return '连接测试失败，请检查网络、Base URL 与凭证'
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: string }).code === 'P2002'
}
