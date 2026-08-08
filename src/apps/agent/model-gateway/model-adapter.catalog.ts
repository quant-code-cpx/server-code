import type { AgentModelProviderName } from 'src/config/model.config'

export interface ModelAdapterDefinition {
  kind: Exclude<AgentModelProviderName, 'fake' | 'openai-compatible'>
  label: string
  transport: 'RESPONSES' | 'CHAT_COMPLETIONS' | 'MESSAGES'
  native: boolean
  defaultBaseUrl: string | null
  reasoningModes: readonly string[]
  builtInEfforts: readonly string[]
  capabilities: readonly string[]
  probeLevels: readonly string[]
  summary: string
}

export const MODEL_ADAPTER_DEFINITIONS: readonly ModelAdapterDefinition[] = Object.freeze([
  {
    kind: 'openai-responses',
    label: 'OpenAI Responses',
    transport: 'RESPONSES',
    native: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    reasoningModes: ['AUTO', 'DISABLED', 'EFFORT'],
    builtInEfforts: ['NONE', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'],
    capabilities: ['STREAMING', 'STRUCTURED_OUTPUT', 'TOOL_CALLING', 'PARALLEL_TOOL_CALLING', 'REASONING_EFFORT'],
    probeLevels: ['AUTH', 'STREAM', 'TOOLS', 'STRUCTURED_OUTPUT'],
    summary: 'OpenAI 原生 Responses 协议，适合推理、工具调用和严格结构化输出。',
  },
  {
    kind: 'openai-chat-compatible',
    label: 'OpenAI Chat Compatible',
    transport: 'CHAT_COMPLETIONS',
    native: false,
    defaultBaseUrl: null,
    reasoningModes: ['AUTO', 'DISABLED', 'EFFORT'],
    builtInEfforts: ['NONE', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'],
    capabilities: ['STREAMING', 'STRUCTURED_OUTPUT', 'TOOL_CALLING', 'PARALLEL_TOOL_CALLING', 'REASONING_EFFORT'],
    probeLevels: ['AUTH', 'STREAM', 'TOOLS', 'STRUCTURED_OUTPUT'],
    summary: '用于中转站与兼容服务；具体参数和能力必须以探测结果为准。',
  },
  {
    kind: 'anthropic-messages',
    label: 'Anthropic Messages',
    transport: 'MESSAGES',
    native: true,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    reasoningModes: ['AUTO', 'DISABLED', 'EFFORT', 'TOKEN_BUDGET'],
    builtInEfforts: ['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'],
    capabilities: ['STREAMING', 'STRUCTURED_OUTPUT', 'TOOL_CALLING', 'VISION', 'REASONING_EFFORT'],
    probeLevels: ['AUTH', 'STREAM', 'TOOLS', 'STRUCTURED_OUTPUT', 'VISION'],
    summary: 'Claude 原生 Messages 协议，支持 adaptive thinking、effort 与旧式 Token budget。',
  },
])

export function getModelAdapterDefinition(kind: string): ModelAdapterDefinition {
  const definition = MODEL_ADAPTER_DEFINITIONS.find((item) => item.kind === kind)
  if (!definition) throw new Error(`[AgentModel] 未注册模型适配器：${kind}`)
  return definition
}
