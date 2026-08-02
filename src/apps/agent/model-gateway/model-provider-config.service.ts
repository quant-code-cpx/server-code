import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { Inject } from '@nestjs/common'
import type { AiModelProvider } from '@prisma/client'
import {
  ModelConfig,
  type AgentModelCostTier,
  type AgentModelProviderConfig,
  type AgentModelProviderName,
  type IModelConfig,
} from 'src/config/model.config'
import { PrismaService } from 'src/shared/prisma.service'
import {
  type CreateModelProviderDto,
  type ModelProviderIdDto,
  type UpdateModelProviderDto,
} from '../api/dto/model/model-provider-request.dto'

const SUPPORTED_KINDS = new Set<AgentModelProviderName>(['openai-compatible'])
const COST_TIERS = new Set(['LOW', 'MEDIUM', 'HIGH'])
const CAPABILITIES = new Set([
  'STREAMING',
  'STRUCTURED_OUTPUT',
  'TOOL_CALLING',
  'PARALLEL_TOOL_CALLING',
  'VISION',
  'REASONING_EFFORT',
])
const REASONING_EFFORTS = new Set(['LOW', 'MEDIUM', 'HIGH'])
const DATA_CLASSES = new Set(['PUBLIC', 'USER_PRIVATE', 'PORTFOLIO_SENSITIVE'])
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

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
    await this.seedFromEnvironmentIfEmpty()
    const rows = await this.prisma.aiModelProvider.findMany({
      where: { enabled: true, kind: 'openai-compatible' },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })
    return rows.map((row) => this.toConfig(row))
  }

  async listAdmin() {
    await this.seedFromEnvironmentIfEmpty()
    const rows = await this.prisma.aiModelProvider.findMany({
      where: { kind: 'openai-compatible' },
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
        where: { enabled: true, kind: 'openai-compatible' },
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
        where: { enabled: true, kind: 'openai-compatible' },
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
    const providers = this.modelConfig.providers.filter((provider) => provider.kind === 'openai-compatible')
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
    if (!row || row.kind !== 'openai-compatible') throw new NotFoundException('模型供应商不存在')
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
    if (kind === 'openai-compatible' && !apiKey)
      throw new BadRequestException('openai-compatible provider 必须配置 apiKey')
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
    if (kind === 'openai-compatible' && !apiKey) throw new Error(`[AgentModel] provider ${row.id} 缺少 apiKey`)
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
    !isIdentifier(model) ||
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
  validateList(reasoningEfforts, REASONING_EFFORTS, 'reasoningEfforts', true)
  validateList(dataClasses, DATA_CLASSES, 'dataClasses')
  if (!Array.isArray(capabilities) || !capabilities.includes('STREAMING')) {
    throw new Error('[AgentModel] capabilities 必须包含 STREAMING')
  }
  if (kind !== 'openai-compatible' || typeof baseUrl !== 'string' || !isSafeBaseUrl(baseUrl))
    throw new Error('[AgentModel] openai-compatible baseUrl 必须是安全 HTTP(S) URL')
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
