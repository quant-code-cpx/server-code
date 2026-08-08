import type { AgentModelProviderConfig } from 'src/config/model.config'
import type { ModelProvider } from './model-gateway.port'
import { AnthropicMessagesProvider } from './providers/anthropic-messages.provider'
import { FakeModelProvider } from './providers/fake-model.provider'
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider'
import { OpenAiResponsesProvider } from './providers/openai-responses.provider'

type ProviderConstructor = new (config: AgentModelProviderConfig) => ModelProvider

const PROVIDER_FACTORIES: Partial<Record<AgentModelProviderConfig['kind'], ProviderConstructor>> = {
  fake: FakeModelProvider,
  'openai-compatible': OpenAiCompatibleProvider,
  'openai-chat-compatible': OpenAiCompatibleProvider,
  'openai-responses': OpenAiResponsesProvider,
  'anthropic-messages': AnthropicMessagesProvider,
}

export function createModelProvider(config: AgentModelProviderConfig): ModelProvider {
  const Provider = PROVIDER_FACTORIES[config.kind]
  if (!Provider) throw new Error(`[AgentModel] 未注册模型适配器：${config.kind}`)
  return new Provider(config)
}
