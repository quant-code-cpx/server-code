import { Inject, Injectable } from '@nestjs/common'
import { ModelConfig, type IModelConfig } from 'src/config/model.config'
import { type ModelDescriptor, type ModelGatewayError } from './model-gateway.port'

export interface ProviderHealthSnapshot {
  provider: string
  model: string
  status: 'HEALTHY' | 'OPEN'
  retryAfterMs: number | null
}

@Injectable()
export class ProviderHealthService {
  private readonly states = new Map<string, { failures: number; openUntil: number }>()

  constructor(@Inject(ModelConfig.KEY) private readonly config: IModelConfig) {}

  isAvailable(descriptor: ModelDescriptor): boolean {
    const state = this.states.get(keyOf(descriptor))
    return !state || state.openUntil <= Date.now()
  }

  recordSuccess(descriptor: ModelDescriptor): void {
    this.states.delete(keyOf(descriptor))
  }

  recordFailure(descriptor: ModelDescriptor, error: ModelGatewayError): void {
    if (!error.retryable || error.visibleOutput) return
    const key = keyOf(descriptor)
    const current = this.states.get(key) ?? { failures: 0, openUntil: 0 }
    const failures = current.failures + 1
    this.states.set(key, {
      failures,
      openUntil: failures >= this.config.circuitFailureThreshold ? Date.now() + this.config.circuitOpenMs : 0,
    })
  }

  snapshot(descriptor: ModelDescriptor): ProviderHealthSnapshot {
    const state = this.states.get(keyOf(descriptor))
    const retryAfterMs = state ? Math.max(0, state.openUntil - Date.now()) : 0
    return {
      provider: descriptor.provider,
      model: descriptor.model,
      status: retryAfterMs > 0 ? 'OPEN' : 'HEALTHY',
      retryAfterMs: retryAfterMs || null,
    }
  }

  snapshots(): ProviderHealthSnapshot[] {
    return [...this.states.entries()].map(([key, state]) => {
      const [provider, model] = key.split('\u0000')
      const retryAfterMs = Math.max(0, state.openUntil - Date.now())
      return { provider, model, status: retryAfterMs > 0 ? 'OPEN' : 'HEALTHY', retryAfterMs: retryAfterMs || null }
    })
  }
}

function keyOf(descriptor: ModelDescriptor): string {
  return `${descriptor.provider}\u0000${descriptor.model}`
}
