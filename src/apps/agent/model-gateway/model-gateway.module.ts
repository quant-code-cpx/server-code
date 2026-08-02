import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ModelConfig, type AgentModelProviderConfig, type IModelConfig } from 'src/config/model.config'
import { ModelCapabilityRegistry } from './model-capability.registry'
import {
  MODEL_GATEWAY,
  MODEL_GATEWAY_OBSERVER,
  MODEL_PROVIDER,
  MODEL_PROVIDERS,
  type ModelProvider,
} from './model-gateway.port'
import { ModelGatewayService } from './model-gateway.service'
import { FakeModelProvider } from './providers/fake-model.provider'
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider'
import { ModelRouterService } from './model-router.service'
import { ProviderHealthService } from './provider-health.service'
import { AgentObservabilityModule } from '../observability/agent-observability.module'
import { AgentMetricsService } from '../observability/agent-metrics.service'
import { ModelProviderConfigService } from './model-provider-config.service'

@Module({
  imports: [ConfigModule.forFeature(ModelConfig), AgentObservabilityModule],
  providers: [
    ModelProviderConfigService,
    {
      provide: MODEL_PROVIDERS,
      inject: [ModelConfig.KEY],
      useFactory: (config: IModelConfig): ModelProvider[] =>
        config.source === 'database' ? [] : config.providers.map(createProvider),
    },
    {
      provide: MODEL_PROVIDER,
      inject: [MODEL_PROVIDERS],
      useFactory: (providers: ModelProvider[]): ModelProvider => providers[0],
    },
    { provide: MODEL_GATEWAY_OBSERVER, useExisting: AgentMetricsService },
    ModelCapabilityRegistry,
    ProviderHealthService,
    ModelRouterService,
    ModelGatewayService,
    { provide: MODEL_GATEWAY, useExisting: ModelGatewayService },
  ],
  exports: [
    MODEL_GATEWAY,
    ModelGatewayService,
    ModelCapabilityRegistry,
    ModelRouterService,
    ProviderHealthService,
    ModelProviderConfigService,
  ],
})
export class ModelGatewayModule {}

function createProvider(config: AgentModelProviderConfig): ModelProvider {
  return config.kind === 'fake' ? new FakeModelProvider(config) : new OpenAiCompatibleProvider(config)
}
