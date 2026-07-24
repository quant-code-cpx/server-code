import { registerAs } from '@nestjs/config'

export const MODEL_CONFIG_TOKEN = 'agentModel'

export type AgentModelProviderName = 'fake' | 'openai-compatible'
export type AgentModelCostTier = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ModelDescriptorConfig {
  contextWindow: number
  maxOutputTokens: number
  capabilities: string[]
  reasoningEfforts: string[]
  dataClasses: string[]
}

export interface AgentModelProviderConfig {
  id: string
  kind: AgentModelProviderName
  displayName: string
  defaultModel: string
  priority: number
  costTier: AgentModelCostTier
  baseUrl: string | null
  apiKey: string | null
  timeoutMs: number
  maxRetries: number
  retryBaseMs: number
  descriptor: ModelDescriptorConfig
}

export interface ModelConfigEnvironment {
  AGENT_MODEL_PROVIDER?: string
  AGENT_MODEL_PROVIDERS?: string
  AGENT_MODEL_BASE_URL?: string
  AGENT_MODEL_BASE_URL_ALLOWLIST?: string
  AGENT_MODEL_API_KEY?: string
  AGENT_MODEL_DEFAULT?: string
  AGENT_MODEL_TIMEOUT_MS?: string
  AGENT_MODEL_MAX_RETRIES?: string
  AGENT_MODEL_RETRY_BASE_MS?: string
  AGENT_MODEL_CAPABILITIES?: string
  AGENT_MODEL_CONTEXT_WINDOW?: string
  AGENT_MODEL_MAX_OUTPUT_TOKENS?: string
  AGENT_MODEL_REASONING_EFFORTS?: string
  AGENT_MODEL_DATA_CLASSES?: string
  AGENT_MODEL_CIRCUIT_FAILURE_THRESHOLD?: string
  AGENT_MODEL_CIRCUIT_OPEN_MS?: string
}

export interface IModelConfig {
  /** Legacy primary provider fields. Keep old deployments and adapters compatible. */
  provider: AgentModelProviderName
  baseUrl: string | null
  apiKey: string | null
  defaultModel: string
  timeoutMs: number
  maxRetries: number
  retryBaseMs: number
  descriptor: ModelDescriptorConfig
  providers: readonly AgentModelProviderConfig[]
  circuitFailureThreshold: number
  circuitOpenMs: number
}

const SUPPORTED_PROVIDERS = new Set<AgentModelProviderName>(['fake', 'openai-compatible'])
const CAPABILITY_VALUES = new Set([
  'STREAMING',
  'STRUCTURED_OUTPUT',
  'TOOL_CALLING',
  'PARALLEL_TOOL_CALLING',
  'VISION',
  'REASONING_EFFORT',
])
const REASONING_EFFORT_VALUES = new Set(['LOW', 'MEDIUM', 'HIGH'])
const DATA_CLASS_VALUES = new Set(['PUBLIC', 'USER_PRIVATE', 'PORTFOLIO_SENSITIVE'])
const COST_TIER_VALUES = new Set<AgentModelCostTier>(['LOW', 'MEDIUM', 'HIGH'])

export function buildModelConfig(env: ModelConfigEnvironment, nodeEnv = 'development'): IModelConfig {
  const isProduction = nodeEnv === 'production'
  const providers = env.AGENT_MODEL_PROVIDERS?.trim()
    ? parseProviders(env.AGENT_MODEL_PROVIDERS, isProduction)
    : [buildLegacyProvider(env, isProduction)]
  const modelNames = new Set<string>()
  for (const provider of providers) {
    if (modelNames.has(provider.defaultModel)) throw new Error('[AgentModel] 不同 provider 的 model 名必须唯一')
    modelNames.add(provider.defaultModel)
  }
  const primary = providers[0]
  return {
    provider: primary.kind,
    baseUrl: primary.baseUrl,
    apiKey: primary.apiKey,
    defaultModel: primary.defaultModel,
    timeoutMs: primary.timeoutMs,
    maxRetries: primary.maxRetries,
    retryBaseMs: primary.retryBaseMs,
    descriptor: primary.descriptor,
    providers,
    circuitFailureThreshold: parseInteger(
      env.AGENT_MODEL_CIRCUIT_FAILURE_THRESHOLD,
      'AGENT_MODEL_CIRCUIT_FAILURE_THRESHOLD',
      3,
      1,
      100,
    ),
    circuitOpenMs: parseInteger(
      env.AGENT_MODEL_CIRCUIT_OPEN_MS,
      'AGENT_MODEL_CIRCUIT_OPEN_MS',
      30_000,
      1_000,
      3_600_000,
    ),
  }
}

export const ModelConfig = registerAs(MODEL_CONFIG_TOKEN, () => buildModelConfig(process.env, process.env.NODE_ENV))

function buildLegacyProvider(env: ModelConfigEnvironment, isProduction: boolean): AgentModelProviderConfig {
  const kindRaw = env.AGENT_MODEL_PROVIDER?.trim()
  if (isProduction && !kindRaw)
    throw new Error('[AgentModel] 生产环境必须显式配置 AGENT_MODEL_PROVIDER 或 AGENT_MODEL_PROVIDERS')
  const kind = (kindRaw || 'fake') as AgentModelProviderName
  if (!SUPPORTED_PROVIDERS.has(kind)) throw new Error(`[AgentModel] AGENT_MODEL_PROVIDER 不支持：${kind}`)
  const common = parseCommon(env)
  if (kind === 'fake') {
    return {
      id: 'fake',
      kind,
      displayName: 'Deterministic Fake',
      defaultModel: env.AGENT_MODEL_DEFAULT?.trim() || 'fake-deterministic-v1',
      priority: 0,
      costTier: 'LOW',
      baseUrl: null,
      apiKey: null,
      ...common,
      descriptor: parseDescriptor(env, true),
    }
  }
  const baseUrl = parseProviderBaseUrl(env.AGENT_MODEL_BASE_URL, env.AGENT_MODEL_BASE_URL_ALLOWLIST, isProduction)
  const apiKey = requireValue(env.AGENT_MODEL_API_KEY, 'AGENT_MODEL_API_KEY')
  const descriptor = parseDescriptor(env, false)
  if (!descriptor.capabilities.includes('STREAMING')) {
    throw new Error('[AgentModel] OpenAI-compatible provider 必须声明 STREAMING capability')
  }
  return {
    id: 'openai-compatible',
    kind,
    displayName: 'OpenAI Compatible',
    defaultModel: requireValue(env.AGENT_MODEL_DEFAULT, 'AGENT_MODEL_DEFAULT'),
    priority: 0,
    costTier: 'MEDIUM',
    baseUrl,
    apiKey,
    ...common,
    descriptor,
  }
}

function parseProviders(raw: string, isProduction: boolean): AgentModelProviderConfig[] {
  let input: unknown
  try {
    input = JSON.parse(raw)
  } catch {
    throw new Error('[AgentModel] AGENT_MODEL_PROVIDERS 必须是 JSON array')
  }
  if (!Array.isArray(input) || input.length < 1 || input.length > 16) {
    throw new Error('[AgentModel] AGENT_MODEL_PROVIDERS 必须包含 1-16 个 provider')
  }
  const ids = new Set<string>()
  return input
    .map((entry, index) => {
      const value = asRecord(entry, `AGENT_MODEL_PROVIDERS[${index}]`)
      const id = requireIdentifier(value.id, `AGENT_MODEL_PROVIDERS[${index}].id`)
      if (ids.has(id)) throw new Error('[AgentModel] AGENT_MODEL_PROVIDERS provider id 不能重复')
      ids.add(id)
      const kind = requireProviderKind(value.kind, `AGENT_MODEL_PROVIDERS[${index}].kind`)
      const defaultModel = requireIdentifier(value.model, `AGENT_MODEL_PROVIDERS[${index}].model`)
      const descriptor = parseInlineDescriptor(value, index, kind === 'fake')
      if (!descriptor.capabilities.includes('STREAMING')) {
        throw new Error(`[AgentModel] AGENT_MODEL_PROVIDERS[${index}] 必须声明 STREAMING capability`)
      }
      const baseUrl =
        kind === 'fake'
          ? null
          : parseProviderBaseUrl(
              asOptionalString(value.baseUrl),
              asOptionalString(value.baseUrlAllowlist),
              isProduction,
            )
      const apiKey =
        kind === 'fake' ? null : requireValue(asOptionalString(value.apiKey), `AGENT_MODEL_PROVIDERS[${index}].apiKey`)
      return {
        id,
        kind,
        displayName: optionalIdentifier(value.displayName) ?? id,
        defaultModel,
        priority: parseInlineInteger(value.priority, `AGENT_MODEL_PROVIDERS[${index}].priority`, index, 0, 1000),
        costTier: parseCostTier(value.costTier, `AGENT_MODEL_PROVIDERS[${index}].costTier`, 'MEDIUM'),
        baseUrl,
        apiKey,
        timeoutMs: parseInlineInteger(
          value.timeoutMs,
          `AGENT_MODEL_PROVIDERS[${index}].timeoutMs`,
          120_000,
          100,
          300_000,
        ),
        maxRetries: parseInlineInteger(value.maxRetries, `AGENT_MODEL_PROVIDERS[${index}].maxRetries`, 0, 0, 2),
        retryBaseMs: parseInlineInteger(
          value.retryBaseMs,
          `AGENT_MODEL_PROVIDERS[${index}].retryBaseMs`,
          200,
          0,
          10_000,
        ),
        descriptor,
      }
    })
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
}

function parseCommon(env: ModelConfigEnvironment) {
  return {
    timeoutMs: parseInteger(env.AGENT_MODEL_TIMEOUT_MS, 'AGENT_MODEL_TIMEOUT_MS', 120_000, 100, 300_000),
    maxRetries: parseInteger(env.AGENT_MODEL_MAX_RETRIES, 'AGENT_MODEL_MAX_RETRIES', 2, 0, 2),
    retryBaseMs: parseInteger(env.AGENT_MODEL_RETRY_BASE_MS, 'AGENT_MODEL_RETRY_BASE_MS', 200, 0, 10_000),
  }
}

function parseDescriptor(env: ModelConfigEnvironment, fake: boolean): ModelDescriptorConfig {
  return {
    contextWindow: parseInteger(
      env.AGENT_MODEL_CONTEXT_WINDOW,
      'AGENT_MODEL_CONTEXT_WINDOW',
      fake ? 32_768 : null,
      1,
      10_000_000,
    ),
    maxOutputTokens: parseInteger(
      env.AGENT_MODEL_MAX_OUTPUT_TOKENS,
      'AGENT_MODEL_MAX_OUTPUT_TOKENS',
      fake ? 4_096 : null,
      1,
      1_000_000,
    ),
    capabilities: fake
      ? parseList(
          env.AGENT_MODEL_CAPABILITIES || 'STREAMING,STRUCTURED_OUTPUT,TOOL_CALLING',
          'AGENT_MODEL_CAPABILITIES',
          CAPABILITY_VALUES,
        )
      : parseRequiredList(env.AGENT_MODEL_CAPABILITIES, 'AGENT_MODEL_CAPABILITIES', CAPABILITY_VALUES),
    reasoningEfforts: parseList(
      env.AGENT_MODEL_REASONING_EFFORTS || (fake ? 'LOW,MEDIUM,HIGH' : ''),
      'AGENT_MODEL_REASONING_EFFORTS',
      REASONING_EFFORT_VALUES,
    ),
    dataClasses: fake
      ? parseList(
          env.AGENT_MODEL_DATA_CLASSES || 'PUBLIC,USER_PRIVATE,PORTFOLIO_SENSITIVE',
          'AGENT_MODEL_DATA_CLASSES',
          DATA_CLASS_VALUES,
        )
      : parseRequiredList(env.AGENT_MODEL_DATA_CLASSES, 'AGENT_MODEL_DATA_CLASSES', DATA_CLASS_VALUES),
  }
}

function parseInlineDescriptor(value: Record<string, unknown>, index: number, fake: boolean): ModelDescriptorConfig {
  const prefix = `AGENT_MODEL_PROVIDERS[${index}]`
  const capabilities = parseInlineList(
    value.capabilities,
    `${prefix}.capabilities`,
    CAPABILITY_VALUES,
    fake ? ['STREAMING', 'STRUCTURED_OUTPUT', 'TOOL_CALLING'] : null,
  )
  const dataClasses = parseInlineList(
    value.dataClasses,
    `${prefix}.dataClasses`,
    DATA_CLASS_VALUES,
    fake ? ['PUBLIC', 'USER_PRIVATE', 'PORTFOLIO_SENSITIVE'] : null,
  )
  return {
    contextWindow: parseInlineInteger(
      value.contextWindow,
      `${prefix}.contextWindow`,
      fake ? 32_768 : null,
      1,
      10_000_000,
    ),
    maxOutputTokens: parseInlineInteger(
      value.maxOutputTokens,
      `${prefix}.maxOutputTokens`,
      fake ? 4_096 : null,
      1,
      1_000_000,
    ),
    capabilities,
    reasoningEfforts: parseInlineList(
      value.reasoningEfforts,
      `${prefix}.reasoningEfforts`,
      REASONING_EFFORT_VALUES,
      fake ? ['LOW', 'MEDIUM', 'HIGH'] : [],
    ),
    dataClasses,
  }
}

function parseProviderBaseUrl(
  raw: string | undefined,
  allowlistRaw: string | undefined,
  isProduction: boolean,
): string {
  const value = requireValue(raw, 'AGENT_MODEL_BASE_URL')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('[AgentModel] AGENT_MODEL_BASE_URL 必须是有效 URL')
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error('[AgentModel] AGENT_MODEL_BASE_URL 禁止 userinfo、query 和 fragment')
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    (url.protocol === 'http:' && (isProduction || !loopbackHosts.has(url.hostname)))
  ) {
    throw new Error('[AgentModel] HTTP base URL 仅允许非生产 loopback 测试')
  }
  if (isProduction && !parseOrigins(allowlistRaw).includes(url.origin)) {
    throw new Error('[AgentModel] 生产 AGENT_MODEL_BASE_URL 必须命中 AGENT_MODEL_BASE_URL_ALLOWLIST')
  }
  return url.toString().replace(/\/$/, '')
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    return [...new Set(raw.split(',').map((item) => new URL(item.trim()).origin))]
  } catch {
    throw new Error('[AgentModel] AGENT_MODEL_BASE_URL_ALLOWLIST 包含无效 origin')
  }
}

function requireValue(value: string | undefined, name: string): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`[AgentModel] ${name} 必填`)
  return normalized
}

function parseInteger(
  raw: string | undefined,
  name: string,
  fallback: number | null,
  minimum: number,
  maximum: number,
): number {
  if (!raw?.trim()) {
    if (fallback == null) throw new Error(`[AgentModel] ${name} 必填`)
    return fallback
  }
  return parseInlineInteger(raw, name, fallback, minimum, maximum)
}

function parseInlineInteger(
  value: unknown,
  name: string,
  fallback: number | null,
  minimum: number,
  maximum: number,
): number {
  if (value == null || value === '') {
    if (fallback == null) throw new Error(`[AgentModel] ${name} 必填`)
    return fallback
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(`[AgentModel] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  return parsed
}

function parseRequiredList(raw: string | undefined, name: string, allowed: Set<string>): string[] {
  if (!raw?.trim()) throw new Error(`[AgentModel] ${name} 必填`)
  return parseList(raw, name, allowed)
}

function parseList(raw: string, name: string, allowed: Set<string>): string[] {
  return parseInlineList(raw.split(','), name, allowed, null)
}

function parseInlineList(value: unknown, name: string, allowed: Set<string>, fallback: string[] | null): string[] {
  if (value == null || value === '') {
    if (fallback == null) throw new Error(`[AgentModel] ${name} 必填`)
    return fallback
  }
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null
  if (!raw) throw new Error(`[AgentModel] ${name} 必须是字符串或字符串数组`)
  const values = [...new Set(raw.map((item) => String(item).trim().toUpperCase()).filter(Boolean))]
  for (const item of values) if (!allowed.has(item)) throw new Error(`[AgentModel] ${name} 包含不支持值：${item}`)
  return values
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`[AgentModel] ${name} 必须是 object`)
  return value as Record<string, unknown>
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function requireIdentifier(value: unknown, name: string): string {
  const normalized = optionalIdentifier(value)
  if (!normalized) throw new Error(`[AgentModel] ${name} 必须是 1-128 位字母、数字、_ 或 -`)
  return normalized
}

function optionalIdentifier(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : null
}

function requireProviderKind(value: unknown, name: string): AgentModelProviderName {
  if (typeof value !== 'string' || !SUPPORTED_PROVIDERS.has(value as AgentModelProviderName)) {
    throw new Error(`[AgentModel] ${name} 不支持`)
  }
  return value as AgentModelProviderName
}

function parseCostTier(value: unknown, name: string, fallback: AgentModelCostTier): AgentModelCostTier {
  if (value == null || value === '') return fallback
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!COST_TIER_VALUES.has(normalized as AgentModelCostTier)) throw new Error(`[AgentModel] ${name} 不支持`)
  return normalized as AgentModelCostTier
}
