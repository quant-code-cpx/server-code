import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common'
import { ModelConfig, type AgentModelProviderConfig, type IModelConfig } from 'src/config/model.config'
import {
  MODEL_PROVIDERS,
  ModelGatewayError,
  type ModelCapability,
  type ModelDescriptor,
  type ModelProvider,
  type ModelRequest,
} from './model-gateway.port'
import { ModelProviderConfigService } from './model-provider-config.service'
import { FakeModelProvider } from './providers/fake-model.provider'
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider'

@Injectable()
export class ModelCapabilityRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly models = new Map<string, Array<{ descriptor: ModelDescriptor; provider: ModelProvider }>>()
  private readonly providerConfigs = new Map<string, AgentModelProviderConfig>()
  private refreshTimer?: NodeJS.Timeout
  private readonly modelConfig: IModelConfig

  constructor(
    @Inject(MODEL_PROVIDERS) providers: ModelProvider | readonly ModelProvider[],
    @Optional() @Inject(ModelConfig.KEY) modelConfig?: IModelConfig,
    @Optional() private readonly configStore?: ModelProviderConfigService,
  ) {
    this.modelConfig = modelConfig ?? ({ source: 'env' } as IModelConfig)
    this.replace(providers)
  }

  async onModuleInit(): Promise<void> {
    if (!this.configStore) return
    try {
      await this.reload()
    } catch (error) {
      if (this.modelConfig.source === 'database') throw error
      // Keep the environment configuration until the database is migrated or repaired.
    }
    this.refreshTimer = setInterval(() => {
      void this.reload().catch(() => undefined)
    }, 5_000)
    this.refreshTimer.unref()
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
  }

  async reload(): Promise<void> {
    if (!this.configStore) return
    const configs = await this.configStore.loadActive()
    this.replace(configs.map(createProvider))
    this.providerConfigs.clear()
    for (const config of configs) this.providerConfigs.set(config.id, config)
  }

  private replace(providers: ModelProvider | readonly ModelProvider[]): void {
    this.models.clear()
    for (const provider of asProviderList(providers)) {
      for (const descriptor of provider.listModels()) {
        const entries = this.models.get(descriptor.model) ?? []
        entries.push({ descriptor, provider })
        this.models.set(descriptor.model, entries)
      }
    }
  }

  list(): readonly ModelDescriptor[] {
    return [...this.models.values()].flatMap((entries) => entries.map((item) => item.descriptor))
  }

  get(modelRef: string): ModelDescriptor {
    const item = this.models.get(modelRef)?.[0]
    if (!item) throw new ModelGatewayError('UNAVAILABLE', false, '请求模型未在 capability registry 注册')
    return item.descriptor
  }

  getProvider(modelRef: string): ModelProvider {
    const item = this.models.get(modelRef)?.[0]
    if (!item) throw new ModelGatewayError('UNAVAILABLE', false, '请求模型未在 capability registry 注册')
    return item.provider
  }

  getProviderForDescriptor(descriptor: ModelDescriptor): ModelProvider {
    const item = this.models.get(descriptor.model)?.find((entry) => entry.descriptor.provider === descriptor.provider)
    if (!item) throw new ModelGatewayError('UNAVAILABLE', false, '请求模型未在 capability registry 注册')
    return item.provider
  }

  getProviderConfig(providerId: string): AgentModelProviderConfig | undefined {
    return this.providerConfigs.get(providerId)
  }

  assertRequestSupported(modelRef: string, request: ModelRequest): ModelDescriptor {
    const descriptor = this.get(modelRef)
    return this.assertDescriptorSupported(descriptor, request)
  }

  assertDescriptorSupported(descriptor: ModelDescriptor, request: ModelRequest): ModelDescriptor {
    const required = requiredCapabilities(request)
    const provider = this.getProviderForDescriptor(descriptor)
    if (!provider.supports(descriptor.model, required)) {
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

function createProvider(config: AgentModelProviderConfig): ModelProvider {
  return config.kind === 'fake' ? new FakeModelProvider(config) : new OpenAiCompatibleProvider(config)
}
