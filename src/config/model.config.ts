import { ConfigType, registerAs } from '@nestjs/config'

export const MODEL_CONFIG_TOKEN = 'agentModel'

export type AgentModelProviderName = 'fake' | 'openai-compatible'

export interface ModelConfigEnvironment {
  AGENT_MODEL_PROVIDER?: string
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

export function buildModelConfig(env: ModelConfigEnvironment, nodeEnv = 'development') {
  const isProduction = nodeEnv === 'production'
  const providerRaw = env.AGENT_MODEL_PROVIDER?.trim()
  if (isProduction && !providerRaw) {
    throw new Error('[AgentModel] 生产环境必须显式配置 AGENT_MODEL_PROVIDER')
  }
  const provider = (providerRaw || 'fake') as AgentModelProviderName
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(`[AgentModel] AGENT_MODEL_PROVIDER 不支持：${provider}`)
  }

  const timeoutMs = parseInteger(env.AGENT_MODEL_TIMEOUT_MS, 'AGENT_MODEL_TIMEOUT_MS', 120_000, 100, 300_000)
  const maxRetries = parseInteger(env.AGENT_MODEL_MAX_RETRIES, 'AGENT_MODEL_MAX_RETRIES', 2, 0, 2)
  const retryBaseMs = parseInteger(env.AGENT_MODEL_RETRY_BASE_MS, 'AGENT_MODEL_RETRY_BASE_MS', 200, 0, 10_000)

  if (provider === 'fake') {
    return {
      provider,
      baseUrl: null,
      apiKey: null,
      defaultModel: env.AGENT_MODEL_DEFAULT?.trim() || 'fake-deterministic-v1',
      timeoutMs,
      maxRetries,
      retryBaseMs,
      descriptor: {
        contextWindow: parseInteger(
          env.AGENT_MODEL_CONTEXT_WINDOW,
          'AGENT_MODEL_CONTEXT_WINDOW',
          32_768,
          1,
          10_000_000,
        ),
        maxOutputTokens: parseInteger(
          env.AGENT_MODEL_MAX_OUTPUT_TOKENS,
          'AGENT_MODEL_MAX_OUTPUT_TOKENS',
          4_096,
          1,
          1_000_000,
        ),
        capabilities: parseList(
          env.AGENT_MODEL_CAPABILITIES || 'STREAMING,STRUCTURED_OUTPUT,TOOL_CALLING',
          'AGENT_MODEL_CAPABILITIES',
          CAPABILITY_VALUES,
        ),
        reasoningEfforts: parseList(
          env.AGENT_MODEL_REASONING_EFFORTS || 'LOW,MEDIUM,HIGH',
          'AGENT_MODEL_REASONING_EFFORTS',
          REASONING_EFFORT_VALUES,
        ),
        dataClasses: parseList(
          env.AGENT_MODEL_DATA_CLASSES || 'PUBLIC,USER_PRIVATE,PORTFOLIO_SENSITIVE',
          'AGENT_MODEL_DATA_CLASSES',
          DATA_CLASS_VALUES,
        ),
      },
    }
  }

  const baseUrl = parseProviderBaseUrl(env.AGENT_MODEL_BASE_URL, env.AGENT_MODEL_BASE_URL_ALLOWLIST, isProduction)
  const apiKey = requireValue(env.AGENT_MODEL_API_KEY, 'AGENT_MODEL_API_KEY')
  const defaultModel = requireValue(env.AGENT_MODEL_DEFAULT, 'AGENT_MODEL_DEFAULT')
  const capabilities = parseRequiredList(env.AGENT_MODEL_CAPABILITIES, 'AGENT_MODEL_CAPABILITIES', CAPABILITY_VALUES)
  if (!capabilities.includes('STREAMING')) {
    throw new Error('[AgentModel] OpenAI-compatible provider 必须声明 STREAMING capability')
  }

  return {
    provider,
    baseUrl,
    apiKey,
    defaultModel,
    timeoutMs,
    maxRetries,
    retryBaseMs,
    descriptor: {
      contextWindow: parseInteger(env.AGENT_MODEL_CONTEXT_WINDOW, 'AGENT_MODEL_CONTEXT_WINDOW', null, 1, 10_000_000),
      maxOutputTokens: parseInteger(
        env.AGENT_MODEL_MAX_OUTPUT_TOKENS,
        'AGENT_MODEL_MAX_OUTPUT_TOKENS',
        null,
        1,
        1_000_000,
      ),
      capabilities,
      reasoningEfforts: parseList(
        env.AGENT_MODEL_REASONING_EFFORTS || '',
        'AGENT_MODEL_REASONING_EFFORTS',
        REASONING_EFFORT_VALUES,
      ),
      dataClasses: parseRequiredList(env.AGENT_MODEL_DATA_CLASSES, 'AGENT_MODEL_DATA_CLASSES', DATA_CLASS_VALUES),
    },
  }
}

export const ModelConfig = registerAs(MODEL_CONFIG_TOKEN, () => buildModelConfig(process.env, process.env.NODE_ENV))

export type IModelConfig = ConfigType<typeof ModelConfig>

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
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('[AgentModel] AGENT_MODEL_BASE_URL 禁止 userinfo、query 和 fragment')
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('[AgentModel] AGENT_MODEL_BASE_URL 仅支持 HTTPS；本地测试允许 loopback HTTP')
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (url.protocol === 'http:' && (isProduction || !loopbackHosts.has(url.hostname))) {
    throw new Error('[AgentModel] HTTP base URL 仅允许非生产 loopback 测试')
  }

  if (isProduction) {
    const allowlist = parseOrigins(allowlistRaw)
    if (allowlist.length === 0 || !allowlist.includes(url.origin)) {
      throw new Error('[AgentModel] 生产 AGENT_MODEL_BASE_URL 必须命中 AGENT_MODEL_BASE_URL_ALLOWLIST')
    }
  }

  return url.toString().replace(/\/$/, '')
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    return [
      ...new Set(
        raw
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .map((value) => new URL(value).origin),
      ),
    ]
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
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`[AgentModel] ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return value
}

function parseRequiredList(raw: string | undefined, name: string, allowed: Set<string>): string[] {
  if (!raw?.trim()) throw new Error(`[AgentModel] ${name} 必填`)
  return parseList(raw, name, allowed)
}

function parseList(raw: string, name: string, allowed: Set<string>): string[] {
  const values = [
    ...new Set(
      raw
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean),
    ),
  ]
  for (const value of values) {
    if (!allowed.has(value)) throw new Error(`[AgentModel] ${name} 包含不支持值：${value}`)
  }
  return values
}
