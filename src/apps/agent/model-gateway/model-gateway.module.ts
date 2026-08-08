import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ModelConfig, type IModelConfig } from 'src/config/model.config'
import { ModelCapabilityRegistry } from './model-capability.registry'
import {
  MODEL_GATEWAY,
  MODEL_GATEWAY_OBSERVER,
  MODEL_PROVIDER,
  MODEL_PROVIDERS,
  type ModelProvider,
} from './model-gateway.port'
import { ModelGatewayService } from './model-gateway.service'
import { createModelProvider } from './model-provider.factory'
import { ModelRouterService } from './model-router.service'
import { ProviderHealthService } from './provider-health.service'
import { AgentObservabilityModule } from '../observability/agent-observability.module'
import { AgentMetricsService } from '../observability/agent-metrics.service'
import { ModelProviderConfigService } from './model-provider-config.service'
import { ModelProviderConsoleService } from './model-provider-console.service'

@Module({
  imports: [ConfigModule.forFeature(ModelConfig), AgentObservabilityModule],
  providers: [
    ModelProviderConfigService,
    ModelProviderConsoleService,
    {
      provide: MODEL_PROVIDERS,
      inject: [ModelConfig.KEY],
      useFactory: (config: IModelConfig): ModelProvider[] =>
        config.source === 'database' ? [] : config.providers.map(createModelProvider),
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
    ModelProviderConsoleService,
  ],
})
export class ModelGatewayModule {}
