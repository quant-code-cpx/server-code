import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { Inject } from '@nestjs/common'
import type { AiModelConnection, AiModelDeployment, AiModelProvider } from '@prisma/client'
import {
  ModelConfig,
  type AgentModelCostTier,
  type AgentModelProviderConfig,
  type AgentModelProviderName,
  type IModelConfig,
  type ModelDescriptorConfig,
} from 'src/config/model.config'
import { PrismaService } from 'src/shared/prisma.service'
import {
  type CreateModelProviderDto,
  type ModelProviderIdDto,
  type UpdateModelProviderDto,
} from '../api/dto/model/model-provider-request.dto'

const SUPPORTED_KINDS = new Set<AgentModelProviderName>([
  'openai-compatible',
  'openai-chat-compatible',
  'openai-responses',
  'anthropic-messages',
])
const COST_TIERS = new Set(['LOW', 'MEDIUM', 'HIGH'])
const CAPABILITIES = new Set([
  'STREAMING',
  'STRUCTURED_OUTPUT',
  'TOOL_CALLING',
  'PARALLEL_TOOL_CALLING',
  'VISION',
  'REASONING_EFFORT',
])
const REASONING_EFFORT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
const DATA_CLASSES = new Set(['PUBLIC', 'USER_PRIVATE', 'PORTFOLIO_SENSITIVE'])
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/

interface SecretEnvelope {
  iv: string
  tag: string
  ciphertext: string
}

@Injectable()
export class ModelProviderConfigService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ModelConfig.KEY) private readonly modelConfig: IModelConfig,
  ) {}

  async loadActive(): Promise<AgentModelProviderConfig[]> {
    const deploymentCount = await this.prisma.aiModelDeployment.count()
    if (deploymentCount > 0) {
      const activeVersion = await this.prisma.aiModelConfigVersion.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      })
      if (activeVersion && Array.isArray(activeVersion.snapshot)) {
        return activeVersion.snapshot.map((item) => this.toSnapshotConfig(item))
      }
      throw new Error('[AgentModel] 已存在 V2 模型部署，但没有 ACTIVE 配置版本；请先验证并发布模型配置')
    }
    await this.seedFromEnvironmentIfEmpty()
    const rows = await this.prisma.aiModelProvider.findMany({
      where: { enabled: true, kind: { in: [...SUPPORTED_KINDS] } },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
    return rows.map((row) => this.toConfig(row))
  }

  async loadDraft(): Promise<AgentModelProviderConfig[]> {
    const deployments = await this.prisma.aiModelDeployment.findMany({
      where: { enabled: true, connection: { enabled: true } },
      include: { connection: true },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
    return deployments.map((row) => this.toDeploymentConfig(row))
  }

  async listAdmin() {
    await this.seedFromEnvironmentIfEmpty()
    const rows = await this.prisma.aiModelProvider.findMany({
      where: { kind: { in: [...SUPPORTED_KINDS] } },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
    return { items: rows.map((row) => this.toAdminResponse(row)) }
  }

  async create(dto: CreateModelProviderDto) {
    const row = await this.prisma.aiModelProvider.create({
      data: { id: randomUUID(), providerId: dto.providerId, ...this.toWriteData(dto) },
    })
    return this.toAdminResponse(row)
  }

  async update(dto: UpdateModelProviderDto) {
    const current = await this.find(dto.id)
    if (current.enabled && dto.enabled === false) {
      const enabledCount = await this.prisma.aiModelProvider.count({
        where: { enabled: true, kind: { in: [...SUPPORTED_KINDS] } },
      })
      if (enabledCount <= 1) throw new BadRequestException('至少保留一个启用中的模型供应商')
    }
    const data = this.toWriteData(dto, current)
    const row = await this.prisma.aiModelProvider.update({ where: { id: dto.id }, data })
    return this.toAdminResponse(row)
  }

  async remove(dto: ModelProviderIdDto) {
    const current = await this.find(dto.id)
    if (current.enabled) {
      const enabledCount = await this.prisma.aiModelProvider.count({
        where: { enabled: true, kind: { in: [...SUPPORTED_KINDS] } },
      })
      if (enabledCount <= 1) throw new BadRequestException('至少保留一个启用中的模型供应商')
    }
    await this.prisma.aiModelProvider.delete({ where: { id: dto.id } })
    return { id: dto.id, deleted: true }
  }

  private async seedFromEnvironmentIfEmpty(): Promise<void> {
    const count = await this.prisma.aiModelProvider.count()
    if (count > 0) return
    if (this.modelConfig.source === 'database') return
    const providers = this.modelConfig.providers.filter((provider) => SUPPORTED_KINDS.has(provider.kind))
    if (providers.length === 0) return
    await this.prisma.aiModelProvider.createMany({
      data: providers.map((provider) => ({
        id: randomUUID(),
        providerId: provider.id,
        kind: provider.kind,
        displayName: provider.displayName,
        model: provider.defaultModel,
        priority: provider.priority,
        costTier: provider.costTier,
        baseUrl: provider.baseUrl,
        encryptedApiKey: provider.apiKey ? this.encrypt(provider.apiKey) : null,
        apiKeyLastFour: provider.apiKey ? lastFour(provider.apiKey) : null,
        contextWindow: provider.descriptor.contextWindow,
        maxOutputTokens: provider.descriptor.maxOutputTokens,
        capabilities: provider.descriptor.capabilities,
        reasoningEfforts: provider.descriptor.reasoningEfforts,
        dataClasses: provider.descriptor.dataClasses,
        timeoutMs: provider.timeoutMs,
        maxRetries: provider.maxRetries,
        retryBaseMs: provider.retryBaseMs,
        enabled: true,
      })),
      skipDuplicates: true,
    })
  }

  private async find(id: string) {
    const row = await this.prisma.aiModelProvider.findUnique({ where: { id } })
    if (!row || !SUPPORTED_KINDS.has(row.kind as AgentModelProviderName))
      throw new NotFoundException('模型供应商不存在')
    return row
  }

  private toWriteData(dto: CreateModelProviderDto | UpdateModelProviderDto, current?: AiModelProvider) {
    const providerId = dto.providerId ?? current?.providerId
    const kind = dto.kind ?? current?.kind
    const model = dto.model ?? current?.model
    const displayName = dto.displayName ?? current?.displayName
    const priority = dto.priority ?? current?.priority
    const costTier = dto.costTier ?? current?.costTier
    const baseUrl = dto.baseUrl !== undefined ? dto.baseUrl : current?.baseUrl
    const contextWindow = dto.contextWindow ?? current?.contextWindow
    const maxOutputTokens = dto.maxOutputTokens ?? current?.maxOutputTokens
    const capabilities = dto.capabilities ?? current?.capabilities
    const reasoningEfforts = dto.reasoningEfforts ?? current?.reasoningEfforts
    const dataClasses = dto.dataClasses ?? current?.dataClasses
    const timeoutMs = dto.timeoutMs ?? current?.timeoutMs
    const maxRetries = dto.maxRetries ?? current?.maxRetries
    const retryBaseMs = dto.retryBaseMs ?? current?.retryBaseMs
    const enabled = dto.enabled ?? current?.enabled ?? true

    if (!isIdentifier(providerId)) throw new BadRequestException('providerId 非法')

    try {
      validateProvider(
        kind,
        model,
        displayName,
        priority,
        costTier,
        baseUrl,
        contextWindow,
        maxOutputTokens,
        capabilities,
        reasoningEfforts,
        dataClasses,
        timeoutMs,
        maxRetries,
        retryBaseMs,
      )
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '模型供应商配置非法')
    }
    const apiKey = dto.apiKey !== undefined ? dto.apiKey : current ? this.decrypt(current.encryptedApiKey) : null
    if (kind !== 'fake' && !apiKey) throw new BadRequestException(`${kind} provider 必须配置 apiKey`)
    return {
      providerId,
      kind,
      displayName,
      model,
      priority,
      costTier,
      baseUrl,
      ...(dto.apiKey !== undefined
        ? {
            encryptedApiKey: dto.apiKey ? this.encrypt(dto.apiKey) : null,
            apiKeyLastFour: dto.apiKey ? lastFour(dto.apiKey) : null,
          }
        : {}),
      contextWindow,
      maxOutputTokens,
      capabilities,
      reasoningEfforts,
      dataClasses,
      timeoutMs,
      maxRetries,
      retryBaseMs,
      enabled,
    }
  }

  private toConfig(row: AiModelProvider): AgentModelProviderConfig {
    const kind = row.kind as AgentModelProviderName
    const costTier = row.costTier as AgentModelCostTier
    const apiKey = this.decrypt(row.encryptedApiKey)
    validateProvider(
      kind,
      row.model,
      row.displayName,
      row.priority,
      row.costTier,
      row.baseUrl,
      row.contextWindow,
      row.maxOutputTokens,
      row.capabilities,
      row.reasoningEfforts,
      row.dataClasses,
      row.timeoutMs,
      row.maxRetries,
      row.retryBaseMs,
    )
    if (kind !== 'fake' && !apiKey) throw new Error(`[AgentModel] provider ${row.id} 缺少 apiKey`)
    return {
      id: row.id,
      kind,
      displayName: row.displayName,
      defaultModel: row.model,
      priority: row.priority,
      costTier,
      baseUrl: row.baseUrl,
      apiKey,
      timeoutMs: row.timeoutMs,
      maxRetries: row.maxRetries,
      retryBaseMs: row.retryBaseMs,
      descriptor: {
        contextWindow: row.contextWindow,
        maxOutputTokens: row.maxOutputTokens,
        capabilities: row.capabilities,
        reasoningEfforts: row.reasoningEfforts,
        dataClasses: row.dataClasses,
      },
    }
  }

  private toDeploymentConfig(row: AiModelDeployment & { connection: AiModelConnection }): AgentModelProviderConfig {
    const kind = row.connection.adapterKind as AgentModelProviderName
    if (!SUPPORTED_KINDS.has(kind)) throw new Error(`[AgentModel] adapter ${kind} 不受支持`)
    const apiKey = this.decrypt(row.connection.encryptedApiKey)
    if (!apiKey) throw new Error(`[AgentModel] connection ${row.connection.connectionKey} 缺少 apiKey`)
    const defaultReasoning = deploymentReasoning(row)
    return {
      id: row.id,
      kind,
      displayName: row.displayName,
      defaultModel: row.modelId,
      priority: row.priority,
      costTier: row.costTier as AgentModelCostTier,
      baseUrl: row.connection.baseUrl,
      apiKey,
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

  private toSnapshotConfig(value: unknown): AgentModelProviderConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('[AgentModel] 活动配置快照格式非法')
    }
    const item = value as Record<string, unknown>
    const kind = item.adapterKind as AgentModelProviderName
    if (!SUPPORTED_KINDS.has(kind)) throw new Error(`[AgentModel] adapter ${kind} 不受支持`)
    const encryptedApiKey = typeof item.encryptedApiKey === 'string' ? item.encryptedApiKey : null
    const apiKey = this.decrypt(encryptedApiKey)
    if (!apiKey) throw new Error(`[AgentModel] 活动配置 ${String(item.deploymentId)} 缺少 apiKey`)
    const capabilities = stringArray(item.capabilities, 'capabilities')
    const reasoningEfforts = stringArray(item.reasoningEfforts, 'reasoningEfforts', true)
    const dataClasses = stringArray(item.dataClasses, 'dataClasses')
    const id = requiredSnapshotString(item.deploymentId, 'deploymentId')
    const displayName = requiredSnapshotString(item.displayName, 'displayName')
    const defaultModel = requiredSnapshotString(item.modelId, 'modelId')
    const priority = requiredSnapshotInteger(item.priority, 'priority')
    const baseUrl = requiredSnapshotString(item.baseUrl, 'baseUrl')
    const timeoutMs = requiredSnapshotInteger(item.timeoutMs, 'timeoutMs')
    const maxRetries = requiredSnapshotInteger(item.maxRetries, 'maxRetries')
    const retryBaseMs = requiredSnapshotInteger(item.retryBaseMs, 'retryBaseMs')
    const contextWindow = requiredSnapshotInteger(item.contextWindow, 'contextWindow')
    const maxOutputTokens = requiredSnapshotInteger(item.maxOutputTokens, 'maxOutputTokens')
    validateProvider(
      kind,
      defaultModel,
      displayName,
      priority,
      item.costTier,
      baseUrl,
      contextWindow,
      maxOutputTokens,
      capabilities,
      reasoningEfforts,
      dataClasses,
      timeoutMs,
      maxRetries,
      retryBaseMs,
    )
    return {
      id,
      kind,
      displayName,
      defaultModel,
      priority,
      costTier: item.costTier as AgentModelCostTier,
      baseUrl,
      apiKey,
      timeoutMs,
      maxRetries,
      retryBaseMs,
      descriptor: {
        contextWindow,
        maxOutputTokens,
        capabilities,
        reasoningEfforts,
        defaultReasoning: snapshotReasoning(item),
        dataClasses,
      },
    }
  }

  private toAdminResponse(row: AiModelProvider) {
    return {
      id: row.id,
      providerId: row.providerId,
      kind: row.kind,
      displayName: row.displayName,
      model: row.model,
      priority: row.priority,
      costTier: row.costTier,
      baseUrl: row.baseUrl,
      apiKeyConfigured: !!row.encryptedApiKey,
      apiKeyLastFour: row.apiKeyLastFour,
      contextWindow: row.contextWindow,
      maxOutputTokens: row.maxOutputTokens,
      capabilities: row.capabilities,
      reasoningEfforts: row.reasoningEfforts,
      dataClasses: row.dataClasses,
      timeoutMs: row.timeoutMs,
      maxRetries: row.maxRetries,
      retryBaseMs: row.retryBaseMs,
      enabled: row.enabled,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const envelope: SecretEnvelope = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
    return JSON.stringify(envelope)
  }

  private decrypt(value: string | null): string | null {
    if (!value) return null
    try {
      const envelope = JSON.parse(value) as SecretEnvelope
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(envelope.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString(
        'utf8',
      )
    } catch {
      throw new Error(
        '[AgentModel] provider apiKey 无法解密，请检查 AGENT_MODEL_DB_ENCRYPTION_KEY 或 ACCESS_TOKEN_SECRET',
      )
    }
  }
}

function validateProvider(
  kind: unknown,
  model: unknown,
  displayName: unknown,
  priority: unknown,
  costTier: unknown,
  baseUrl: unknown,
  contextWindow: unknown,
  maxOutputTokens: unknown,
  capabilities: unknown,
  reasoningEfforts: unknown,
  dataClasses: unknown,
  timeoutMs: unknown,
  maxRetries: unknown,
  retryBaseMs: unknown,
): void {
  if (typeof kind !== 'string' || !SUPPORTED_KINDS.has(kind as AgentModelProviderName))
    throw new Error('[AgentModel] provider kind 不支持')
  if (
    !isModelId(model) ||
    typeof displayName !== 'string' ||
    displayName.trim().length < 1 ||
    displayName.length > 128
  ) {
    throw new Error('[AgentModel] model/displayName 非法')
  }
  if (!Number.isInteger(priority) || (priority as number) < 0 || (priority as number) > 1000)
    throw new Error('[AgentModel] priority 非法')
  if (typeof costTier !== 'string' || !COST_TIERS.has(costTier)) throw new Error('[AgentModel] costTier 不支持')
  if (!Number.isInteger(contextWindow) || (contextWindow as number) < 1)
    throw new Error('[AgentModel] contextWindow 非法')
  if (!Number.isInteger(maxOutputTokens) || (maxOutputTokens as number) < 1)
    throw new Error('[AgentModel] maxOutputTokens 非法')
  if (!Number.isInteger(timeoutMs) || (timeoutMs as number) < 100) throw new Error('[AgentModel] timeoutMs 非法')
  if (!Number.isInteger(maxRetries) || (maxRetries as number) < 0 || (maxRetries as number) > 2)
    throw new Error('[AgentModel] maxRetries 非法')
  if (!Number.isInteger(retryBaseMs) || (retryBaseMs as number) < 0) throw new Error('[AgentModel] retryBaseMs 非法')
  validateList(capabilities, CAPABILITIES, 'capabilities')
  validateReasoningEfforts(reasoningEfforts)
  validateList(dataClasses, DATA_CLASSES, 'dataClasses')
  if (!Array.isArray(capabilities) || !capabilities.includes('STREAMING')) {
    throw new Error('[AgentModel] capabilities 必须包含 STREAMING')
  }
  if (typeof baseUrl !== 'string' || !isSafeBaseUrl(baseUrl))
    throw new Error(`[AgentModel] ${kind} baseUrl 必须是安全 HTTP(S) URL`)
}

function validateReasoningEfforts(value: unknown): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !REASONING_EFFORT_PATTERN.test(item))) {
    throw new Error('[AgentModel] reasoningEfforts 非法')
  }
}

function validateList(value: unknown, allowed: Set<string>, name: string, allowEmpty = false): void {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== 'string' || !allowed.has(item))
  ) {
    throw new Error(`[AgentModel] ${name} 非法`)
  }
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

function isModelId(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ID_PATTERN.test(value)
}

function isSafeBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const localHttp =
      process.env.NODE_ENV !== 'production' &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (!(url.protocol === 'https:' || localHttp) || url.username || url.password || url.search || url.hash)
      return false
    if (process.env.NODE_ENV === 'production') {
      const allowlist = (process.env.AGENT_MODEL_BASE_URL_ALLOWLIST || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => {
          try {
            return new URL(item).origin
          } catch {
            return null
          }
        })
        .filter((item): item is string => !!item)
      if (!allowlist.includes(url.origin)) return false
    }
    return true
  } catch {
    return false
  }
}

function encryptionKey(): Buffer {
  const raw = process.env.AGENT_MODEL_DB_ENCRYPTION_KEY?.trim() || process.env.ACCESS_TOKEN_SECRET?.trim()
  if (!raw) throw new Error('[AgentModel] 缺少 AGENT_MODEL_DB_ENCRYPTION_KEY 或 ACCESS_TOKEN_SECRET')
  return createHash('sha256').update(raw, 'utf8').digest()
}

function lastFour(value: string): string {
  return value.slice(-4).padStart(4, '*')
}

function deploymentReasoning(row: AiModelDeployment): ModelDescriptorConfig['defaultReasoning'] {
  if (row.reasoningMode === 'DISABLED') return { mode: 'DISABLED' }
  if (row.reasoningMode === 'EFFORT' && row.defaultReasoningEffort) {
    return { mode: 'EFFORT', effort: row.defaultReasoningEffort }
  }
  if (row.reasoningMode === 'TOKEN_BUDGET' && row.reasoningBudgetTokens) {
    return {
      mode: 'TOKEN_BUDGET',
      budgetTokens: row.reasoningBudgetTokens,
      ...(row.defaultReasoningEffort ? { effort: row.defaultReasoningEffort } : {}),
    }
  }
  return { mode: 'AUTO' }
}

function snapshotReasoning(item: Record<string, unknown>): ModelDescriptorConfig['defaultReasoning'] {
  const mode = item.reasoningMode
  if (mode === 'DISABLED') return { mode: 'DISABLED' }
  const effort = typeof item.defaultReasoningEffort === 'string' ? item.defaultReasoningEffort : undefined
  if (mode === 'EFFORT' && effort) return { mode: 'EFFORT', effort }
  const budgetTokens = item.reasoningBudgetTokens
  if (mode === 'TOKEN_BUDGET' && Number.isInteger(budgetTokens) && (budgetTokens as number) > 0) {
    return { mode: 'TOKEN_BUDGET', budgetTokens: budgetTokens as number, ...(effort ? { effort } : {}) }
  }
  return { mode: 'AUTO' }
}

function requiredSnapshotString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`[AgentModel] 活动配置快照 ${name} 非法`)
  return value
}

function requiredSnapshotInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value)) throw new Error(`[AgentModel] 活动配置快照 ${name} 非法`)
  return value as number
}

function stringArray(value: unknown, name: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`[AgentModel] 活动配置快照 ${name} 非法`)
  }
  return value as string[]
}
