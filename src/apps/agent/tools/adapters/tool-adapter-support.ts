import type { AgentToolKey } from '../../contracts'
import type { ToolSourceType, ToolResult, ToolWarning } from '../contracts/tool-result'
import type { ToolAccessContext } from '../tool-access-context'
import { hashStableJson } from '../tool-json'

export interface AdapterToolResultOptions {
  version: number
  sourceType: ToolSourceType
  sourceServices: string[]
  sourceModels: string[]
  tradeDate?: string
  unit?: string
  currency?: string
  adjustment?: 'NONE' | 'FORWARD' | 'BACKWARD'
  dataVersion?: string
  algorithmVersion?: string
  warnings?: ToolWarning[]
  truncated?: boolean
  nextCursor?: string
}

export function adapterToolResult<T>(
  context: ToolAccessContext,
  input: unknown,
  toolKey: AgentToolKey,
  data: T,
  options: AdapterToolResultOptions,
): ToolResult<T> {
  return {
    ok: true,
    toolCallId: context.toolCallId,
    toolKey,
    toolVersion: options.version,
    data,
    provenance: {
      sourceType: options.sourceType,
      sourceServices: options.sourceServices,
      sourceModels: options.sourceModels,
      asOf: {
        ...(options.tradeDate ? { tradeDate: options.tradeDate } : {}),
        retrievedAt: new Date().toISOString(),
      },
      timezone: 'Asia/Shanghai',
      ...(options.unit ? { unit: options.unit } : {}),
      ...(options.currency ? { currency: options.currency } : {}),
      ...(options.adjustment ? { adjustment: options.adjustment } : {}),
      ...(options.dataVersion ? { dataVersion: options.dataVersion } : {}),
      ...(options.algorithmVersion ? { algorithmVersion: options.algorithmVersion } : {}),
      inputHash: hashStableJson(input),
    },
    citationSourceIds: [],
    warnings: options.warnings ?? [],
    truncated: options.truncated ?? false,
    ...(options.nextCursor ? { nextCursor: options.nextCursor } : {}),
  }
}
