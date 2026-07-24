import { Inject, Injectable } from '@nestjs/common'
import {
  MODEL_PROVIDERS,
  ModelGatewayError,
  type ModelCapability,
  type ModelDescriptor,
  type ModelProvider,
  type ModelRequest,
} from './model-gateway.port'

@Injectable()
export class ModelCapabilityRegistry {
  private readonly models = new Map<string, { descriptor: ModelDescriptor; provider: ModelProvider }>()

  constructor(@Inject(MODEL_PROVIDERS) providers: ModelProvider | readonly ModelProvider[]) {
    for (const provider of asProviderList(providers)) {
      for (const descriptor of provider.listModels()) {
        if (this.models.has(descriptor.model)) throw new Error(`[AgentModel] model 重复注册：${descriptor.model}`)
        this.models.set(descriptor.model, { descriptor, provider })
      }
    }
    if (this.models.size === 0) throw new Error('[AgentModel] 至少需要注册一个模型')
  }

  list(): readonly ModelDescriptor[] {
    return [...this.models.values()].map((item) => item.descriptor)
  }

  get(modelRef: string): ModelDescriptor {
    const item = this.models.get(modelRef)
    if (!item) throw new ModelGatewayError('UNAVAILABLE', false, '请求模型未在 capability registry 注册')
    return item.descriptor
  }

  getProvider(modelRef: string): ModelProvider {
    const item = this.models.get(modelRef)
    if (!item) throw new ModelGatewayError('UNAVAILABLE', false, '请求模型未在 capability registry 注册')
    return item.provider
  }

  assertRequestSupported(modelRef: string, request: ModelRequest): ModelDescriptor {
    const descriptor = this.get(modelRef)
    const required = requiredCapabilities(request)
    const provider = this.getProvider(modelRef)
    if (!provider.supports(modelRef, required)) {
      throw new ModelGatewayError('UNAVAILABLE', false, '请求模型不满足所需 capability')
    }
    if (request.maxOutputTokens > descriptor.maxOutputTokens) {
      throw new ModelGatewayError('CONTENT', false, 'maxOutputTokens 超过模型配置上限')
    }
    if (request.reasoningEffort && !descriptor.reasoningEfforts.includes(request.reasoningEffort)) {
      throw new ModelGatewayError('UNAVAILABLE', false, '模型不支持指定 reasoning effort')
    }
    const dataClass = request.dataClass ?? 'PUBLIC'
    if (!descriptor.dataClasses.includes(dataClass)) {
      throw new ModelGatewayError('CONTENT', false, '模型不允许处理当前数据分类')
    }
    return descriptor
  }
}

export function requiredCapabilities(
  request: Pick<ModelRequest, 'responseSchema' | 'tools' | 'reasoningEffort'>,
): ModelCapability[] {
  const required: ModelCapability[] = ['STREAMING']
  if (request.responseSchema) required.push('STRUCTURED_OUTPUT')
  if (request.tools?.length) required.push('TOOL_CALLING')
  if (request.reasoningEffort) required.push('REASONING_EFFORT')
  return required
}

function asProviderList(value: ModelProvider | readonly ModelProvider[]): readonly ModelProvider[] {
  return 'provider' in value ? [value] : value
}
