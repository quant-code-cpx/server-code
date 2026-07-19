import { Inject, Injectable } from '@nestjs/common'
import {
  MODEL_PROVIDER,
  ModelGatewayError,
  type ModelCapability,
  type ModelDescriptor,
  type ModelProvider,
  type ModelRequest,
} from './model-gateway.port'

@Injectable()
export class ModelCapabilityRegistry {
  constructor(@Inject(MODEL_PROVIDER) private readonly provider: ModelProvider) {}

  get(modelRef: string): ModelDescriptor {
    const descriptor = this.provider.listModels().find((item) => item.model === modelRef)
    if (!descriptor) throw new ModelGatewayError('UNAVAILABLE', false, '请求模型未在 capability registry 注册')
    return descriptor
  }

  assertRequestSupported(modelRef: string, request: ModelRequest): ModelDescriptor {
    const descriptor = this.get(modelRef)
    const required: ModelCapability[] = ['STREAMING']
    if (request.responseSchema) required.push('STRUCTURED_OUTPUT')
    if (request.tools?.length) required.push('TOOL_CALLING')
    if (request.reasoningEffort) required.push('REASONING_EFFORT')

    if (!this.provider.supports(modelRef, required)) {
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
