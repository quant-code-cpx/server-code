import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ModelConfig, type IModelConfig } from 'src/config/model.config'
import { ModelCapabilityRegistry } from './model-capability.registry'
import {
  MODEL_GATEWAY,
  MODEL_GATEWAY_OBSERVER,
  MODEL_PROVIDER,
  type ModelGatewayObserver,
  type ModelProvider,
} from './model-gateway.port'
import { ModelGatewayService } from './model-gateway.service'
import { FakeModelProvider } from './providers/fake-model.provider'
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider'

const NOOP_MODEL_GATEWAY_OBSERVER: ModelGatewayObserver = { record: () => undefined }

@Module({
  imports: [ConfigModule.forFeature(ModelConfig)],
  providers: [
    {
      provide: MODEL_PROVIDER,
      inject: [ModelConfig.KEY],
      useFactory: (config: IModelConfig): ModelProvider =>
        config.provider === 'fake' ? new FakeModelProvider(config) : new OpenAiCompatibleProvider(config),
    },
    { provide: MODEL_GATEWAY_OBSERVER, useValue: NOOP_MODEL_GATEWAY_OBSERVER },
    ModelCapabilityRegistry,
    ModelGatewayService,
    { provide: MODEL_GATEWAY, useExisting: ModelGatewayService },
  ],
  exports: [MODEL_GATEWAY, ModelGatewayService, ModelCapabilityRegistry],
})
export class ModelGatewayModule {}
