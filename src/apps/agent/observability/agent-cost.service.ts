import { Inject, Injectable } from '@nestjs/common'
import { AgentObservabilityConfig, type IAgentObservabilityConfig } from 'src/config/agent-observability.config'
import type { ModelDescriptor, ModelUsage } from '../model-gateway/model-gateway.port'
import { AgentMetricsService, type AgentCostSource } from './agent-metrics.service'

export interface AgentCostEstimate {
  amount: number | null
  currency: string | null
  estimated: boolean
  source: AgentCostSource | null
  priceCatalogVersion: string | null
}

@Injectable()
export class AgentCostService {
  constructor(
    @Inject(AgentObservabilityConfig.KEY) private readonly config: IAgentObservabilityConfig,
    private readonly metrics: AgentMetricsService,
  ) {}

  estimate(descriptor: Pick<ModelDescriptor, 'provider' | 'model'>, usage: ModelUsage | null): AgentCostEstimate {
    const providerCost = usage?.providerCost
    if (providerCost) {
      const amount = Number(providerCost.amount)
      if (Number.isFinite(amount) && amount >= 0 && /^[A-Za-z]{3}$/.test(providerCost.currency)) {
        const result: AgentCostEstimate = {
          amount,
          currency: providerCost.currency.toUpperCase(),
          estimated: providerCost.estimated,
          source: 'provider',
          priceCatalogVersion: null,
        }
        this.observe({ provider: descriptor.provider, model: descriptor.model, ...result })
        return result
      }
    }
    const price = this.config.priceCatalog.find(
      (entry) => entry.provider === descriptor.provider && entry.model === descriptor.model,
    )
    if (usage && price) {
      const amount = roundCurrency(
        (usage.inputTokens * price.inputPerMillion +
          usage.outputTokens * price.outputPerMillion +
          (usage.cachedTokens ?? 0) * price.cachedPerMillion +
          (usage.reasoningTokens ?? 0) * price.reasoningPerMillion) /
          1_000_000,
      )
      const result: AgentCostEstimate = {
        amount,
        currency: price.currency,
        estimated: true,
        source: 'catalog',
        priceCatalogVersion: this.config.priceCatalogVersion,
      }
      this.observe({ provider: descriptor.provider, model: descriptor.model, ...result })
      return result
    }
    const result: AgentCostEstimate = {
      amount: null,
      currency: null,
      estimated: false,
      source: null,
      priceCatalogVersion: null,
    }
    this.observe({ provider: descriptor.provider, model: descriptor.model, ...result })
    return result
  }

  private observe(input: {
    provider: string
    model: string
    amount: number | null
    currency: string | null
    source: AgentCostSource | null
    estimated: boolean
  }): void {
    try {
      this.metrics.observeCost(input)
    } catch {
      // Observability must not turn a completed provider call into a failed workflow.
    }
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000
}
