import type { AgentToolKey } from '../../contracts'

export type ToolSourceType = 'DATABASE' | 'PROGRAM_CALCULATION' | 'OFFICIAL' | 'MEDIA' | 'INSTITUTION'

export interface ToolProvenanceAsOf {
  tradeDate?: string
  reportPeriod?: string
  announcementDate?: string
  availableAt?: string
  retrievedAt: string
}

export interface ToolProvenance {
  sourceType: ToolSourceType
  sourceServices: string[]
  sourceModels: string[]
  asOf: ToolProvenanceAsOf
  timezone: string
  unit?: string
  currency?: string
  adjustment?: 'NONE' | 'FORWARD' | 'BACKWARD'
  dataVersion?: string
  algorithmVersion?: string
  inputHash?: string
  outputHash?: string
}

export interface ToolWarning {
  code: string
  message: string
  affectedFields?: string[]
}

export interface ToolResult<TData = unknown> {
  ok: true
  toolCallId: string
  toolKey: AgentToolKey
  toolVersion: number
  data: TData
  provenance: ToolProvenance
  citationSourceIds: string[]
  warnings: ToolWarning[]
  truncated: boolean
  nextCursor?: string
}
