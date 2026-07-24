import type { AgentToolKey } from 'src/apps/agent/contracts'
import { ModelGatewayError, type ModelPurpose } from 'src/apps/agent/model-gateway/model-gateway.port'
import { ToolAdapterError, type ToolErrorCode } from 'src/apps/agent/tools/contracts/tool-error'

export class AgentFaults {
  private readonly modelFailures = new Map<ModelPurpose, Error[]>()
  private readonly toolFailures = new Map<AgentToolKey, Error[]>()

  failNextModel(
    purpose: ModelPurpose,
    error: Error = new ModelGatewayError('UNAVAILABLE', true, '模型供应商暂不可用'),
  ): void {
    enqueue(this.modelFailures, purpose, error)
  }

  failNextTool(toolKey: AgentToolKey, code: ToolErrorCode = 'DATA_NOT_FOUND', message = '测试数据不可用'): void {
    enqueue(this.toolFailures, toolKey, new ToolAdapterError(code, message, isRetryableToolError(code)))
  }

  takeModelFailure(purpose: ModelPurpose): Error | null {
    return dequeue(this.modelFailures, purpose)
  }

  takeToolFailure(toolKey: AgentToolKey): Error | null {
    return dequeue(this.toolFailures, toolKey)
  }

  reset(): void {
    this.modelFailures.clear()
    this.toolFailures.clear()
  }
}

function isRetryableToolError(code: ToolErrorCode): boolean {
  return ['RATE_LIMITED', 'TIMEOUT', 'UPSTREAM_FAILED', 'DATA_NOT_READY', 'INTERNAL_ERROR'].includes(code)
}

function enqueue<TKey>(store: Map<TKey, Error[]>, key: TKey, error: Error): void {
  const queue = store.get(key) ?? []
  queue.push(error)
  store.set(key, queue)
}

function dequeue<TKey>(store: Map<TKey, Error[]>, key: TKey): Error | null {
  const queue = store.get(key)
  const error = queue?.shift() ?? null
  if (queue?.length === 0) store.delete(key)
  return error
}
