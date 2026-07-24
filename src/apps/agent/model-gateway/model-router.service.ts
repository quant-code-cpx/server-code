import { Injectable } from '@nestjs/common'
import { ModelCapabilityRegistry } from './model-capability.registry'
import { ProviderHealthService } from './provider-health.service'
import {
  ModelGatewayError,
  type ModelRequest,
  type ModelRouteCandidate,
  type ModelRouteDecision,
} from './model-gateway.port'

@Injectable()
export class ModelRouterService {
  constructor(
    private readonly registry: ModelCapabilityRegistry,
    private readonly health: ProviderHealthService,
  ) {}

  select(request: ModelRequest): ModelRouteDecision {
    const manual = (request.modelPolicy ?? 'AUTO') === 'MANUAL'
    const requested = request.preferredModel?.trim() || null
    if (manual && !requested)
      throw new ModelGatewayError('UNAVAILABLE', false, 'MANUAL modelPolicy 必须指定 preferredModel')
    const considered: ModelRouteDecision['considered'] = []
    const candidates: ModelRouteCandidate[] = []

    for (const descriptor of this.registry.list()) {
      const reasonCodes: string[] = []
      if (manual && descriptor.model !== requested) reasonCodes.push('MANUAL_MODEL_MISMATCH')
      if (!manual && requested && descriptor.model !== requested) reasonCodes.push('PREFERRED_MODEL_NOT_SELECTED')
      if (!this.health.isAvailable(descriptor)) reasonCodes.push('CIRCUIT_OPEN')
      try {
        this.registry.assertRequestSupported(descriptor.model, request)
      } catch (error) {
        reasonCodes.push(error instanceof ModelGatewayError ? `CAPABILITY_${error.category}` : 'CAPABILITY_INVALID')
      }
      considered.push({ provider: descriptor.provider, model: descriptor.model, reasonCodes })
      if (reasonCodes.length === 0) candidates.push({ descriptor, reasonCodes: ['POLICY_ALLOWED', 'HEALTHY'] })
    }

    if (candidates.length === 0) {
      throw new ModelGatewayError(
        'UNAVAILABLE',
        false,
        manual ? '用户选择的模型不可用或不满足当前请求' : '没有满足策略的可用模型',
      )
    }
    return { candidates, considered, selected: candidates[0].descriptor }
  }
}
