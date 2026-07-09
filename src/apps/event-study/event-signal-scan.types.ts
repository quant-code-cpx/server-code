export type EventSignalScanJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'DELAYED' | 'UNKNOWN'

export interface EventSignalScanJobData {
  tradeDate: string
  requestedByUserId?: number
  requestedAt: string
}

export interface EventSignalScanJobResult {
  tradeDate: string
  signalsGenerated: number
  completedAt: string
}
