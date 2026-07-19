import type { UserRole } from '@prisma/client'
import type { AgentToolKey, JsonSchema } from '../../contracts'
import type { ToolAccessContext } from '../tool-access-context'
import type { ToolResult } from './tool-result'

export type ToolSideEffect = 'READ' | 'WRITE' | 'DESTRUCTIVE'
export type ToolCostClass = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ToolPolicyDefinition {
  requiredRole: UserRole
  sideEffect: ToolSideEffect
  requiresConfirmation: boolean
  idempotent: boolean
  timeoutMs: number
  maxAttempts: number
  maxRows: number
  costClass: ToolCostClass
  allowedDataScopes: readonly string[]
}

export interface ToolDefinition<TInput = Record<string, unknown>, TData = unknown> {
  key: AgentToolKey
  version: number
  description: string
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  policy: ToolPolicyDefinition
  execute(input: TInput, context: ToolAccessContext): Promise<ToolResult<TData>>
  countRows?(data: TData): number
}

export interface ToolRegistryPin {
  key: AgentToolKey
  version: number
}

export interface ToolRegistrySnapshot {
  entries: readonly ToolRegistryPin[]
  signature: string
}
