export interface ValidationEntry {
  tsCode?: string | null
  tradeDate?: string | null
  ruleName: string // 'missing_pk' | 'invalid_number' | 'ohlc_violation' | …
  severity: 'info' | 'warn' | 'error'
  message: string
  rawData?: Record<string, unknown>
}

export class ValidationCollector {
  private readonly entries: ValidationEntry[] = []
  private readonly taskName: string
  /** 单次同步最多收集的异常条数，防止全量回补时 OOM */
  private readonly maxEntries: number

  constructor(taskName: string, maxEntries = 5000) {
    this.taskName = taskName
    this.maxEntries = maxEntries
  }

  get task(): string {
    return this.taskName
  }

  get size(): number {
    return this.entries.length
  }

  add(entry: ValidationEntry): void {
    if (this.entries.length < this.maxEntries) {
      this.entries.push(entry)
    }
  }

  /** 返回本次收集的所有条目并清空内部缓冲 */
  drain(): ValidationEntry[] {
    return this.entries.splice(0)
  }
}
