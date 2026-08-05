import { finiteOrNull, toIsoDate } from './market-multi-asset.types'

export interface ResearchBar {
  tradeDate: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  preClose: number | null
  change: number | null
  pctChg: number | null
  vol: number | null
  amount: number | null
}

export function aggregateResearchBars(bars: readonly ResearchBar[], frequency: 'D' | 'W' | 'M'): ResearchBar[] {
  if (frequency === 'D') return bars.map((bar) => ({ ...bar }))
  const groups = new Map<string, ResearchBar[]>()
  for (const bar of bars) {
    const key = frequency === 'M' ? bar.tradeDate.slice(0, 7) : isoWeekKey(bar.tradeDate)
    const values = groups.get(key) ?? []
    values.push(bar)
    groups.set(key, values)
  }
  return [...groups.values()].map(aggregateGroup)
}

export function deterministicEvenSample<T>(values: readonly T[], maximum: number): T[] {
  if (values.length <= maximum) return [...values]
  if (maximum === 1) return [values[values.length - 1]]
  const indices = new Set<number>([0, values.length - 1])
  for (let i = 1; i < maximum - 1; i += 1) {
    indices.add(Math.round((i * (values.length - 1)) / (maximum - 1)))
  }
  return [...indices].sort((a, b) => a - b).map((index) => values[index])
}

export function stableDescendingRanks<T>(
  values: readonly T[],
  metric: (value: T) => number | null,
  code: (value: T) => string,
): Array<T & { rank: number }> {
  return [...values]
    .sort((left, right) => {
      const leftMetric = metric(left)
      const rightMetric = metric(right)
      if (leftMetric === null && rightMetric === null) return code(left).localeCompare(code(right))
      if (leftMetric === null) return 1
      if (rightMetric === null) return -1
      return rightMetric - leftMetric || code(left).localeCompare(code(right))
    })
    .map((value, index) => ({ ...value, rank: index + 1 }))
}

function aggregateGroup(group: ResearchBar[]): ResearchBar {
  const ordered = [...group].sort((left, right) => left.tradeDate.localeCompare(right.tradeDate))
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  const open = first.open
  const close = last.close
  const preClose = first.preClose
  const highs = ordered.map((bar) => bar.high).filter((value): value is number => value !== null)
  const lows = ordered.map((bar) => bar.low).filter((value): value is number => value !== null)
  const change = close !== null && preClose !== null ? close - preClose : null
  return {
    tradeDate: last.tradeDate,
    open,
    high: highs.length ? Math.max(...highs) : null,
    low: lows.length ? Math.min(...lows) : null,
    close,
    preClose,
    change,
    pctChg: change !== null && preClose ? (change / preClose) * 100 : null,
    vol: sumNullable(ordered.map((bar) => bar.vol)),
    amount: sumNullable(ordered.map((bar) => bar.amount)),
  }
}

function sumNullable(values: Array<number | null>): number | null {
  const finite = values.map(finiteOrNull).filter((value): value is number => value !== null)
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) : null
}

function isoWeekKey(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}-${toIsoDate(date)}`
}
