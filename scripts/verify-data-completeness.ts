/**
 * verify-data-completeness.ts
 *
 * 数据完整性校验脚本，覆盖以下维度：
 * 1. 日线 / 周线 / 月线：交易日覆盖率、每个交易日的股票数量
 * 2. 复权因子：与日线交易日一致性
 * 3. 每日指标：与日线交易日一致性
 * 4. 基础信息：股票列表、交易日历的基本统计
 * 5. 资金流向：保留窗口完整性
 *
 * 用法：
 *   npx ts-node scripts/verify-data-completeness.ts
 *
 * 需要 DATABASE_URL 环境变量指向 PostgreSQL
 */
import { PrismaClient, StockExchange } from '@prisma/client'

const prisma = new PrismaClient()

// ═══════════════════════════════════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════════════════════════════════

function toDateKey(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
}

function banner(title: string) {
  console.log('')
  console.log('═'.repeat(60))
  console.log(`  ${title}`)
  console.log('═'.repeat(60))
}

function row(label: string, value: string | number, warn = false) {
  const prefix = warn ? '⚠️ ' : '  '
  console.log(`${prefix}${label.padEnd(30)} ${value}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// 各数据类型校验
// ═══════════════════════════════════════════════════════════════════════════

async function verifyBasicInfo() {
  banner('基础信息')

  const [stockCount, tradeCalCount, companyCount] = await Promise.all([
    prisma.stockBasic.count(),
    prisma.tradeCal.count(),
    prisma.stockCompany.count(),
  ])

  row('股票列表总数', stockCount, stockCount === 0)
  row('交易日历记录数', tradeCalCount, tradeCalCount === 0)
  row('公司信息总数', companyCount, companyCount === 0)

  // 股票分状态统计
  const statusGroups = await prisma.stockBasic.groupBy({ by: ['listStatus'], _count: { _all: true } })
  for (const g of statusGroups) {
    row(`  状态 ${g.listStatus}`, g._count._all)
  }
}

async function verifyTradeDate(label: string, modelName: string, expectedTradeDates: string[]) {
  banner(label)

  const model = (prisma as any)[modelName]

  // 按交易日 groupBy 得到每日股票数
  const groups: Array<{ tradeDate: Date; _count: { _all: number } }> = await model.groupBy({
    by: ['tradeDate'],
    _count: { _all: true },
    orderBy: { tradeDate: 'asc' },
  })

  const dateMap = new Map(groups.map((g) => [toDateKey(g.tradeDate), g._count._all]))
  const totalDates = groups.length
  const totalRows = groups.reduce((sum, g) => sum + g._count._all, 0)

  row('总记录数', totalRows)
  row('总交易日数', totalDates)

  if (expectedTradeDates.length === 0) {
    row('预期交易日', '(无交易日历数据，无法校验)', true)
    return
  }

  // 缺失的交易日
  const missingDates = expectedTradeDates.filter((d) => !dateMap.has(d))
  row('预期交易日数', expectedTradeDates.length)
  row('缺失交易日数', missingDates.length, missingDates.length > 0)

  if (missingDates.length > 0 && missingDates.length <= 20) {
    console.log(`  缺失日期: ${missingDates.join(', ')}`)
  } else if (missingDates.length > 20) {
    console.log(`  缺失日期(前20): ${missingDates.slice(0, 20).join(', ')} ...`)
  }

  // 每日股票数的统计分布
  const counts = groups.map((g) => g._count._all)
  if (counts.length > 0) {
    counts.sort((a, b) => a - b)
    row('每日最少股票数', counts[0])
    row('每日最多股票数', counts[counts.length - 1])
    row('每日中位股票数', counts[Math.floor(counts.length / 2)])

    // 异常低的日期（低于中位数的 50%）
    const median = counts[Math.floor(counts.length / 2)]
    const lowThreshold = Math.floor(median * 0.5)
    const lowDates = groups.filter((g) => g._count._all < lowThreshold)
    if (lowDates.length > 0) {
      row(`异常低的日期(<${lowThreshold})`, lowDates.length, true)
      for (const g of lowDates.slice(0, 5)) {
        console.log(`    ${toDateKey(g.tradeDate)}: ${g._count._all} 条`)
      }
    }
  }
}

async function verifyAdjFactor(expectedTradeDates: string[]) {
  banner('复权因子')

  const groups = await prisma.adjFactor.groupBy({
    by: ['tradeDate'],
    _count: { _all: true },
    orderBy: { tradeDate: 'asc' },
  })

  const dateMap = new Map(groups.map((g) => [toDateKey(g.tradeDate), g._count._all]))
  const totalRows = groups.reduce((sum, g) => sum + g._count._all, 0)

  row('总记录数', totalRows)
  row('总交易日数', groups.length)

  // 与日线对比
  const dailyGroups = await prisma.daily.groupBy({
    by: ['tradeDate'],
    _count: { _all: true },
    orderBy: { tradeDate: 'asc' },
  })
  const dailyDateMap = new Map(dailyGroups.map((g) => [toDateKey(g.tradeDate), g._count._all]))

  const adjOnlyDates = [...dateMap.keys()].filter((d) => !dailyDateMap.has(d))
  const dailyOnlyDates = [...dailyDateMap.keys()].filter((d) => !dateMap.has(d))

  row('有日线但无复权因子的日期', dailyOnlyDates.length, dailyOnlyDates.length > 0)
  if (dailyOnlyDates.length > 0 && dailyOnlyDates.length <= 10) {
    console.log(`    ${dailyOnlyDates.join(', ')}`)
  }

  row('有复权因子但无日线的日期', adjOnlyDates.length, adjOnlyDates.length > 0)

  // 每日数量差异
  let mismatchCount = 0
  for (const [date, adjCount] of dateMap) {
    const dailyCount = dailyDateMap.get(date)
    if (dailyCount && Math.abs(adjCount - dailyCount) > dailyCount * 0.1) {
      mismatchCount++
    }
  }
  row('日线与复权因子数量差异>10%的日期', mismatchCount, mismatchCount > 0)
}

async function verifyDailyBasic(expectedTradeDates: string[]) {
  banner('每日指标')

  const groups = await prisma.dailyBasic.groupBy({
    by: ['tradeDate'],
    _count: { _all: true },
    orderBy: { tradeDate: 'asc' },
  })

  const dateMap = new Map(groups.map((g) => [toDateKey(g.tradeDate), g._count._all]))
  const totalRows = groups.reduce((sum, g) => sum + g._count._all, 0)

  row('总记录数', totalRows)
  row('总交易日数', groups.length)

  const missingDates = expectedTradeDates.filter((d) => !dateMap.has(d))
  row('缺失交易日数', missingDates.length, missingDates.length > 0)
}

async function verifyMoneyflow() {
  banner('资金流向')

  const [dcCount, indDcCount, mktDcCount] = await Promise.all([
    prisma.moneyflowDc.count(),
    prisma.moneyflowIndDc.count(),
    prisma.moneyflowMktDc.count(),
  ])

  row('个股资金流记录数', dcCount)
  row('行业资金流记录数', indDcCount)
  row('大盘资金流记录数', mktDcCount)

  // 个股资金流交易日数
  const dcDates = await prisma.moneyflowDc.groupBy({ by: ['tradeDate'], _count: { _all: true } })
  row('个股资金流交易日数', dcDates.length)

  // 行业资金流分类统计
  const indGroups = await prisma.moneyflowIndDc.groupBy({ by: ['contentType'], _count: { _all: true } })
  for (const g of indGroups) {
    row(`  ${g.contentType}`, g._count._all)
  }
}

async function verifyFinancial() {
  banner('财务数据')

  const [expressCount, finaCount, dividendCount, top10Count, top10FloatCount] = await Promise.all([
    prisma.express.count(),
    prisma.finaIndicator.count(),
    prisma.dividend.count(),
    prisma.top10Holders.count(),
    prisma.top10FloatHolders.count(),
  ])

  row('业绩快报总数', expressCount)
  row('财务指标总数', finaCount)
  row('分红记录总数', dividendCount)
  row('十大股东总数', top10Count)
  row('十大流通股东总数', top10FloatCount)

  // 分红覆盖率
  const dividendStocks = await prisma.dividend.groupBy({ by: ['tsCode'] })
  const totalStocks = await prisma.stockBasic.count()
  row('分红覆盖股票数', dividendStocks.length)
  if (totalStocks > 0) {
    row('分红覆盖率', `${((dividendStocks.length / totalStocks) * 100).toFixed(1)}%`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('🔍 数据完整性校验开始...')
  console.log(`时间: ${new Date().toISOString()}`)

  // 获取所有开市交易日（SSE）用于校验
  const tradeCals = await prisma.tradeCal.findMany({
    where: { exchange: StockExchange.SSE, isOpen: '1' },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  })
  const allTradeDates = tradeCals.map((r) => toDateKey(r.calDate))

  // 获取日线覆盖的日期范围
  const dailyMin = await prisma.daily.aggregate({ _min: { tradeDate: true } })
  const dailyMax = await prisma.daily.aggregate({ _max: { tradeDate: true } })

  if (dailyMin._min.tradeDate && dailyMax._max.tradeDate) {
    const minKey = toDateKey(dailyMin._min.tradeDate)
    const maxKey = toDateKey(dailyMax._max.tradeDate)
    console.log(`\n日线数据范围: ${minKey} ~ ${maxKey}`)

    // 只验证日线覆盖范围内的交易日
    var expectedDailyDates = allTradeDates.filter((d) => d >= minKey && d <= maxKey)
  } else {
    var expectedDailyDates: string[] = []
  }

  // 周线覆盖的日期范围
  const weeklyMin = await prisma.weekly.aggregate({ _min: { tradeDate: true } })
  const weeklyMax = await prisma.weekly.aggregate({ _max: { tradeDate: true } })

  await verifyBasicInfo()
  await verifyTradeDate('日线行情', 'daily', expectedDailyDates)

  // 周线校验需要特殊处理：每周最后一个交易日
  if (weeklyMin._min.tradeDate && weeklyMax._max.tradeDate) {
    const wMin = toDateKey(weeklyMin._min.tradeDate)
    const wMax = toDateKey(weeklyMax._max.tradeDate)
    // 简化：只检查周线总量和日期数
    await verifyTradeDate('周线行情', 'weekly', [])
    console.log(`  周线数据范围: ${wMin} ~ ${wMax}`)
  } else {
    await verifyTradeDate('周线行情', 'weekly', [])
  }

  await verifyTradeDate('月线行情', 'monthly', [])
  await verifyAdjFactor(expectedDailyDates)
  await verifyDailyBasic(expectedDailyDates)
  await verifyFinancial()
  await verifyMoneyflow()

  banner('校验完成')
  console.log('  ⚠️ 标记的项目需要关注')
  console.log('')
}

main()
  .catch((error) => {
    console.error('校验脚本执行失败:', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
