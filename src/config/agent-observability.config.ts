import { registerAs } from '@nestjs/config'

export const AGENT_OBSERVABILITY_CONFIG_TOKEN = 'agentObservability'

export interface AgentModelPriceCatalogEntry {
  provider: string
  model: string
  currency: string
  inputPerMillion: number
  outputPerMillion: number
  cachedPerMillion: number
  reasoningPerMillion: number
}

export interface AgentObservabilityConfigEnvironment {
  AGENT_OBSERVABILITY_ENABLED?: string
  AGENT_OBSERVABILITY_TRACE_SAMPLE_RATE?: string
  AGENT_MODEL_PRICE_CATALOG_VERSION?: string
  AGENT_MODEL_PRICE_CATALOG?: string
}

export function buildAgentObservabilityConfig(env: AgentObservabilityConfigEnvironment) {
  return {
    enabled: env.AGENT_OBSERVABILITY_ENABLED !== 'false',
    traceSampleRate: parseRate(env.AGENT_OBSERVABILITY_TRACE_SAMPLE_RATE),
    priceCatalogVersion: text(env.AGENT_MODEL_PRICE_CATALOG_VERSION, 'unconfigured'),
    priceCatalog: parseCatalog(env.AGENT_MODEL_PRICE_CATALOG),
  }
}

export const AgentObservabilityConfig = registerAs(AGENT_OBSERVABILITY_CONFIG_TOKEN, () =>
  buildAgentObservabilityConfig(process.env),
)

export type IAgentObservabilityConfig = ReturnType<typeof buildAgentObservabilityConfig>

function parseRate(raw: string | undefined): number {
  if (!raw?.trim()) return 1
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('[AgentObservability] AGENT_OBSERVABILITY_TRACE_SAMPLE_RATE 必须是 0-1 数值')
  }
  return value
}

function parseCatalog(raw: string | undefined): readonly AgentModelPriceCatalogEntry[] {
  if (!raw?.trim()) return []
  let source: unknown
  try {
    source = JSON.parse(raw)
  } catch {
    throw new Error('[AgentObservability] AGENT_MODEL_PRICE_CATALOG 必须是 JSON array')
  }
  if (!Array.isArray(source) || source.length > 128) {
    throw new Error('[AgentObservability] AGENT_MODEL_PRICE_CATALOG 必须包含 0-128 项')
  }
  const keys = new Set<string>()
  return source.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`[AgentObservability] AGENT_MODEL_PRICE_CATALOG[${index}] 必须是对象`)
    }
    const value = item as Record<string, unknown>
    const provider = identifier(value.provider, `AGENT_MODEL_PRICE_CATALOG[${index}].provider`)
    const model = identifier(value.model, `AGENT_MODEL_PRICE_CATALOG[${index}].model`)
    const currency = identifier(value.currency, `AGENT_MODEL_PRICE_CATALOG[${index}].currency`, 3).toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`[AgentObservability] AGENT_MODEL_PRICE_CATALOG[${index}].currency 必须是 ISO 货币代码`)
    }
    const key = `${provider}\u0000${model}`
    if (keys.has(key)) throw new Error('[AgentObservability] AGENT_MODEL_PRICE_CATALOG provider/model 不能重复')
    keys.add(key)
    return {
      provider,
      model,
      currency,
      inputPerMillion: nonNegative(value.inputPerMillion, `AGENT_MODEL_PRICE_CATALOG[${index}].inputPerMillion`),
      outputPerMillion: nonNegative(value.outputPerMillion, `AGENT_MODEL_PRICE_CATALOG[${index}].outputPerMillion`),
      cachedPerMillion: nonNegative(
        value.cachedPerMillion ?? 0,
        `AGENT_MODEL_PRICE_CATALOG[${index}].cachedPerMillion`,
      ),
      reasoningPerMillion: nonNegative(
        value.reasoningPerMillion ?? 0,
        `AGENT_MODEL_PRICE_CATALOG[${index}].reasoningPerMillion`,
      ),
    }
  })
}

function text(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() || fallback
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(normalized)) {
    throw new Error('[AgentObservability] price catalog version 非法')
  }
  return normalized
}

function identifier(value: unknown, name: string, maximum = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new Error(`[AgentObservability] ${name} 非法`)
  }
  return value.trim()
}

function nonNegative(value: unknown, name: string): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) {
    throw new Error(`[AgentObservability] ${name} 必须是 0-1000000 数值`)
  }
  return number
}
