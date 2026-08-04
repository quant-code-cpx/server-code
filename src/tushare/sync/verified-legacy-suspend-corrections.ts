import { Prisma } from '@prisma/client'

/**
 * Tushare suspend_d 的早期历史存在已核验缺口。这里只收录同时满足以下条件的修正：
 * 1. 交易所开市但 Daily 无行情；
 * 2. 上市公司官方文件能确认当日召开股东大会；
 * 3. 当时上交所规则要求股东大会召开日全天停牌。
 *
 * 依据：
 * - 特变电工 2003 年报（上交所）：https://static.sse.com.cn/sseportal/cs/zhs/scfw/gg/ssgs/2004-02-10/600089_2003_n.pdf
 * - 上交所关于 2012 年修订的说明（明确原规则要求股东大会日全天停牌）：
 *   https://www.sse.com.cn/aboutus/mediacenter/hotandd/c/c_20150912_3988587.shtml
 */
const VERIFIED_LEGACY_SUSPEND_CORRECTIONS: readonly Prisma.SuspendDCreateManyInput[] = [
  { tsCode: '600089.SH', tradeDate: '19980520', suspendTiming: null, suspendType: 'S' },
  { tsCode: '600089.SH', tradeDate: '19981120', suspendTiming: null, suspendType: 'S' },
]

const correctionsByTradeDate = new Map<string, readonly Prisma.SuspendDCreateManyInput[]>()

for (const correction of VERIFIED_LEGACY_SUSPEND_CORRECTIONS) {
  const corrections = correctionsByTradeDate.get(correction.tradeDate) ?? []
  correctionsByTradeDate.set(correction.tradeDate, [...corrections, correction])
}

export function mergeVerifiedLegacySuspendCorrections(
  tradeDate: string,
  rows: Prisma.SuspendDCreateManyInput[],
): Prisma.SuspendDCreateManyInput[] {
  const merged = new Map(rows.map((row) => [`${row.tsCode}:${row.tradeDate}`, row]))

  for (const correction of correctionsByTradeDate.get(tradeDate) ?? []) {
    const key = `${correction.tsCode}:${correction.tradeDate}`
    if (!merged.has(key)) merged.set(key, correction)
  }

  return [...merged.values()]
}
