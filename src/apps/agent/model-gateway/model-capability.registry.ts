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
import { createModelProvider } from './model-provider.factory'

export interface ModelExecutionBudgetConfig {
  providerId: string
  model: string
  timeoutMs: number
  maxRetries: number
  retryBaseMs: number
}

export interface ModelRunProfileSnapshot {
  schemaVersion: 1
  snapshottedAt: string
  source: 'RUN_CREATION'
  selectedProvider: string
  selectedModel: string
  candidates: ModelDescriptor[]
}

export interface ModelRunProfileRequirements {
  capabilities: readonly ModelCapability[]
  dataClass: ModelDescriptor['dataClasses'][number]
}

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
    // Fake providers are deliberately environment-only and cannot be persisted by
    // ModelProviderConfigService. Reloading an empty DB in test mode would erase
    // the deterministic provider before the first Agent Run starts.
    if (this.modelConfig.providers?.some((provider) => provider.kind === 'fake')) return
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
    this.replaceConfigs(configs)
  }

  async validateDraft(): Promise<void> {
    if (!this.configStore) return
    const configs = await this.configStore.loadDraft()
    if (configs.length === 0) throw new ModelGatewayError('UNAVAILABLE', false, '至少需要一个可发布的模型部署')
    configs.map(createModelProvider)
  }

  private replaceConfigs(configs: AgentModelProviderConfig[]): void {
    this.replace(configs.map(createModelProvider))
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

  snapshotRunProfile(
    modelPolicy: 'AUTO' | 'MANUAL',
    preferredModel: string | null,
    requirements: ModelRunProfileRequirements = {
      capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
      dataClass: 'USER_PRIVATE',
    },
  ): ModelRunProfileSnapshot {
    const candidates = this.list().filter(
      (descriptor) =>
        (modelPolicy !== 'MANUAL' || descriptor.model === preferredModel) &&
        requirements.capabilities.every((capability) => descriptor.capabilities.includes(capability)) &&
        descriptor.dataClasses.includes(requirements.dataClass),
    )
    if (modelPolicy === 'MANUAL' && !preferredModel) {
      throw new ModelGatewayError('UNAVAILABLE', false, 'MANUAL modelPolicy 必须指定 preferredModel')
    }
    if (candidates.length === 0) {
      throw new ModelGatewayError('UNAVAILABLE', false, 'Run 创建时没有可冻结的模型部署')
    }
    const frozen = candidates.map(cloneDescriptor)
    return {
      schemaVersion: 1,
      snapshottedAt: new Date().toISOString(),
      source: 'RUN_CREATION',
      selectedProvider: frozen[0].provider,
      selectedModel: frozen[0].model,
      candidates: frozen,
    }
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

  executionBudgetConfigs(modelRef?: string | null): readonly ModelExecutionBudgetConfig[] {
    const entries = modelRef ? (this.models.get(modelRef) ?? []) : [...this.models.values()].flat()
    return this.executionBudgetConfigsForDescriptors(entries.map(({ descriptor }) => descriptor))
  }

  executionBudgetConfigsForDescriptors(descriptors: readonly ModelDescriptor[]): readonly ModelExecutionBudgetConfig[] {
    const configs = new Map<string, ModelExecutionBudgetConfig>()
    for (const descriptor of descriptors) {
      const config =
        this.providerConfigs.get(descriptor.provider) ??
        this.modelConfig.providers?.find((provider) => provider.id === descriptor.provider)
      if (!config) continue
      configs.set(`${descriptor.provider}:${descriptor.model}`, {
        providerId: descriptor.provider,
        model: descriptor.model,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
        retryBaseMs: config.retryBaseMs,
      })
    }
    return [...configs.values()]
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
    const requestedEffort =
      request.reasoning?.mode === 'EFFORT' || request.reasoning?.mode === 'TOKEN_BUDGET'
        ? request.reasoning.effort
        : request.reasoningEffort
    if (requestedEffort && !supportsEffort(descriptor.reasoningEfforts, requestedEffort)) {
      throw new ModelGatewayError('UNAVAILABLE', false, '模型不支持指定 reasoning effort')
    }
    const dataClass = request.dataClass ?? 'PUBLIC'
    if (!descriptor.dataClasses.includes(dataClass)) {
      throw new ModelGatewayError('CONTENT', false, '模型不允许处理当前数据分类')
    }
    return descriptor
  }
}

function cloneDescriptor(descriptor: ModelDescriptor): ModelDescriptor {
  return {
    ...descriptor,
    ...(descriptor.defaultReasoning ? { defaultReasoning: { ...descriptor.defaultReasoning } } : {}),
    capabilities: [...descriptor.capabilities],
    reasoningEfforts: [...descriptor.reasoningEfforts],
    dataClasses: [...descriptor.dataClasses],
  }
}

export function requiredCapabilities(
  request: Pick<ModelRequest, 'responseSchema' | 'tools' | 'reasoning' | 'reasoningEffort' | 'metadata'>,
): ModelCapability[] {
  const required: ModelCapability[] = ['STREAMING']
  if (request.responseSchema) required.push('STRUCTURED_OUTPUT')
  if (request.tools?.length) required.push('TOOL_CALLING')
  if (request.tools?.length && request.metadata?.parallelToolCalls === true) required.push('PARALLEL_TOOL_CALLING')
  if (request.reasoningEffort || (request.reasoning && !['AUTO', 'DISABLED'].includes(request.reasoning.mode))) {
    required.push('REASONING_EFFORT')
  }
  return required
}

function supportsEffort(supported: readonly string[], effort: string): boolean {
  const normalized = effort.trim().toLowerCase()
  return supported.some((item) => item.trim().toLowerCase() === normalized)
}

function asProviderList(value: ModelProvider | readonly ModelProvider[]): readonly ModelProvider[] {
  return 'provider' in value ? [value] : value
}
