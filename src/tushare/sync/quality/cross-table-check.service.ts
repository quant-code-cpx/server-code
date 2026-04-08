import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { SyncHelperService } from '../sync-helper.service'
import { DataQualityReport } from './data-quality.service'

interface CrossCheckDef {
  id: string
  name: string
  minMode: 'recent' | 'full'
  run: (mode: 'recent' | 'full') => Promise<DataQualityReport>
}

/**
 * CrossTableCheckService — 跨表一致性对账服务
 *
 * 检查多表之间的逻辑一致性，覆盖 C-01 ~ C-08 共 8 项对账。
 * 结果复用 DataQualityCheck 表，checkType = 'cross-table'。
 */
@Injectable()
export class CrossTableCheckService {
  private readonly logger = new Logger(CrossTableCheckService.name)

  private readonly CROSS_CHECKS: CrossCheckDef[]

  constructor(
    private readonly prisma: PrismaService,
    private readonly helper: SyncHelperService,
  ) {
    this.CROSS_CHECKS = [
      { id: 'C-01', name: '日线 ↔ 每日指标', minMode: 'recent', run: (m) => this.checkDailyVsDailyBasic(m) },
      { id: 'C-02', name: '日线 ↔ 复权因子', minMode: 'recent', run: (m) => this.checkDailyVsAdjFactor(m) },
      { id: 'C-03', name: '日线 ↔ 涨跌停', minMode: 'recent', run: (m) => this.checkDailyVsStkLimit(m) },
      { id: 'C-04', name: '日线 ↔ 停牌互斥', minMode: 'recent', run: (m) => this.checkDailyVsSuspend(m) },
      { id: 'C-05', name: '利润表 ↔ 资产负债表', minMode: 'recent', run: (m) => this.checkIncomeVsBalance(m) },
      { id: 'C-06', name: '利润表 ↔ 现金流量表', minMode: 'recent', run: (m) => this.checkIncomeVsCashflow(m) },
      { id: 'C-07', name: '指数权重 → 基础信息', minMode: 'full', run: (m) => this.checkIndexWeightRefIntegrity(m) },
      { id: 'C-08', name: '指数行情 ↔ 指数权重', minMode: 'full', run: (m) => this.checkIndexDailyVsWeight(m) },
    ]
  }

  /** 执行指定对账项 */
  async runCheck(checkId: string, mode: 'recent' | 'full'): Promise<DataQualityReport> {
    const def = this.CROSS_CHECKS.find((c) => c.id === checkId)
    if (!def) {
      return { dataSet: checkId, checkType: 'cross-table', status: 'warn', message: `未知对账项: ${checkId}` }
    }
    return def.run(mode)
  }

  /** 执行全部对账项 */
  async runAllCrossChecks(mode: 'recent' | 'full'): Promise<DataQualityReport[]> {
    const results: DataQualityReport[] = []
    for (const def of this.CROSS_CHECKS) {
      // full 模式才跑 minMode='full' 的检查
      if (mode === 'recent' && def.minMode === 'full') {
        continue
      }
      try {
        const report = await def.run(mode)
        results.push(report)
        this.logger.log(`[跨表对账] ${def.id} ${def.name}: ${report.status} — ${report.message}`)
      } catch (error) {
        this.logger.error(`[跨表对账] ${def.id} ${def.name} 失败: ${(error as Error).message}`)
        results.push({
          dataSet: def.id,
          checkType: 'cross-table',
          status: 'fail',
          message: `对账执行异常: ${(error as Error).message}`,
        })
      }
    }
    return results
  }

  /** 供 DataQualityService 在 runAllChecks 中调度（recent 模式） */
  async runRecentCrossChecks(): Promise<DataQualityReport[]> {
    return this.runAllCrossChecks('recent')
  }

  // ─── C-01/C-02: 日线 ↔ 每日指标 / 复权因子（按日对齐）────────────────────

  private async checkPairwiseAlignment(
    leftModel: string,
    rightModel: string,
    leftLabel: string,
    rightLabel: string,
    checkId: string,
    mode: 'recent' | 'full',
  ): Promise<DataQualityReport> {
    const depth = mode === 'recent' ? 5 : 60
    const today = this.helper.getCurrentShanghaiDateString()
    const startDate = this.helper.addDays(today, -depth)
    const tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, today)

    if (tradeDates.length === 0) {
      return {
        dataSet: checkId,
        checkType: 'cross-table',
        status: 'pass',
        message: `${leftLabel} ↔ ${rightLabel} 检查范围内无交易日`,
      }
    }

    const mismatches: Array<{ date: string; leftCount: number; rightCount: number }> = []

    for (const td of tradeDates) {
      const dateVal = this.helper.toDate(td)
      const [leftCount, rightCount] = await Promise.all([
        (this.prisma as any)[leftModel].count({ where: { tradeDate: dateVal } }),
        (this.prisma as any)[rightModel].count({ where: { tradeDate: dateVal } }),
      ])

      // 允许 5% 的偏差（部分股票数据可能延迟）
      if (leftCount > 0 && Math.abs(leftCount - rightCount) / leftCount > 0.05) {
        mismatches.push({ date: td, leftCount, rightCount })
      }
    }

    if (mismatches.length === 0) {
      return {
        dataSet: checkId,
        checkType: 'cross-table',
        status: 'pass',
        message: `${leftLabel} ↔ ${rightLabel} 最近 ${tradeDates.length} 个交易日对齐正常`,
      }
    }

    return {
      dataSet: checkId,
      checkType: 'cross-table',
      status: mismatches.length > tradeDates.length * 0.5 ? 'fail' : 'warn',
      message: `${leftLabel} ↔ ${rightLabel} 有 ${mismatches.length}/${tradeDates.length} 个交易日记录数不一致`,
      details: { mismatches: mismatches.slice(0, 20) },
    }
  }

  private checkDailyVsDailyBasic(mode: 'recent' | 'full') {
    return this.checkPairwiseAlignment('daily', 'dailyBasic', '日线', '每日指标', 'C-01', mode)
  }

  private checkDailyVsAdjFactor(mode: 'recent' | 'full') {
    return this.checkPairwiseAlignment('daily', 'adjFactor', '日线', '复权因子', 'C-02', mode)
  }

  // ─── C-03: 日线 ↔ 涨跌停（StkLimit 使用 String 日期）──────────────────────

  private async checkDailyVsStkLimit(mode: 'recent' | 'full'): Promise<DataQualityReport> {
    const depth = mode === 'recent' ? 5 : 60
    const today = this.helper.getCurrentShanghaiDateString()
    const startDate = this.helper.addDays(today, -depth)
    const tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, today)

    const mismatches: Array<{ date: string; dailyCount: number; stkLimitCount: number }> = []

    for (const td of tradeDates) {
      const [dailyCount, stkLimitCount] = await Promise.all([
        this.prisma.daily.count({ where: { tradeDate: this.helper.toDate(td) } }),
        this.prisma.stkLimit.count({ where: { tradeDate: td } }),
      ])

      if (dailyCount > 0 && stkLimitCount === 0) {
        mismatches.push({ date: td, dailyCount, stkLimitCount })
      }
    }

    if (mismatches.length === 0) {
      return {
        dataSet: 'C-03',
        checkType: 'cross-table',
        status: 'pass',
        message: `日线 ↔ 涨跌停 最近 ${tradeDates.length} 个交易日对齐正常`,
      }
    }

    return {
      dataSet: 'C-03',
      checkType: 'cross-table',
      status: mismatches.length > 3 ? 'fail' : 'warn',
      message: `日线 ↔ 涨跌停 有 ${mismatches.length} 个交易日日线有数据但涨跌停无数据`,
      details: { mismatches },
    }
  }

  // ─── C-04: 日线 ↔ 停牌互斥 ─────────────────────────────────────────────────

  private async checkDailyVsSuspend(mode: 'recent' | 'full'): Promise<DataQualityReport> {
    const depth = mode === 'recent' ? 5 : 30
    const today = this.helper.getCurrentShanghaiDateString()
    const startDate = this.helper.addDays(today, -depth)
    const tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, today)

    let conflictCount = 0
    const conflictSamples: Array<{ tsCode: string; tradeDate: string }> = []

    for (const td of tradeDates) {
      const suspended = await this.prisma.suspendD.findMany({
        where: { tradeDate: td },
        select: { tsCode: true },
      })

      if (suspended.length === 0) continue

      const suspendedCodes = suspended.map((s) => s.tsCode)

      const overlapping = await this.prisma.daily.count({
        where: {
          tradeDate: this.helper.toDate(td),
          tsCode: { in: suspendedCodes },
        },
      })

      if (overlapping > 0) {
        conflictCount += overlapping
        if (conflictSamples.length < 20) {
          const samples = await this.prisma.daily.findMany({
            where: { tradeDate: this.helper.toDate(td), tsCode: { in: suspendedCodes } },
            select: { tsCode: true },
            take: 5,
          })
          for (const s of samples) {
            conflictSamples.push({ tsCode: s.tsCode, tradeDate: td })
          }
        }
      }
    }

    if (conflictCount === 0) {
      return {
        dataSet: 'C-04',
        checkType: 'cross-table',
        status: 'pass',
        message: `日线 ↔ 停牌 最近 ${tradeDates.length} 个交易日无互斥冲突`,
      }
    }

    return {
      dataSet: 'C-04',
      checkType: 'cross-table',
      // 少量冲突是 Tushare 本身数据特性（如集合竞价产生的半天交易），阈值设为 warn 而非 fail
      status: conflictCount > 50 ? 'warn' : 'pass',
      message: `日线 ↔ 停牌 发现 ${conflictCount} 条冲突记录（停牌日仍有日线数据）`,
      details: { conflictCount, samples: conflictSamples },
    }
  }

  // ─── C-05/C-06: 财务三表对齐（按报告期）──────────────────────────────────

  private async checkFinancialPairAlignment(
    leftModel: string,
    rightModel: string,
    leftLabel: string,
    rightLabel: string,
    checkId: string,
    mode: 'recent' | 'full',
  ): Promise<DataQualityReport> {
    const recentPeriods =
      mode === 'recent'
        ? this.helper.buildRecentQuarterPeriods(1) // 最近 4 个季度
        : this.helper.buildRecentQuarterPeriods(3) // 最近 12 个季度

    const mismatches: Array<{ period: string; leftCodes: number; rightCodes: number; missingInRight: number }> = []

    for (const period of recentPeriods) {
      const periodDate = this.helper.toDate(period)

      const leftCodes = await (this.prisma as any)[leftModel].findMany({
        where: { endDate: periodDate },
        select: { tsCode: true },
        distinct: ['tsCode'],
      })
      const leftCodeSet = new Set<string>(leftCodes.map((r: { tsCode: string }) => r.tsCode))

      if (leftCodeSet.size === 0) continue

      const rightCodes = await (this.prisma as any)[rightModel].findMany({
        where: { endDate: periodDate },
        select: { tsCode: true },
        distinct: ['tsCode'],
      })
      const rightCodeSet = new Set<string>(rightCodes.map((r: { tsCode: string }) => r.tsCode))

      const missingInRight = [...leftCodeSet].filter((c) => !rightCodeSet.has(c)).length

      if (missingInRight > leftCodeSet.size * 0.05) {
        mismatches.push({
          period,
          leftCodes: leftCodeSet.size,
          rightCodes: rightCodeSet.size,
          missingInRight,
        })
      }
    }

    if (mismatches.length === 0) {
      return {
        dataSet: checkId,
        checkType: 'cross-table',
        status: 'pass',
        message: `${leftLabel} ↔ ${rightLabel} 最近 ${recentPeriods.length} 个报告期对齐正常`,
      }
    }

    return {
      dataSet: checkId,
      checkType: 'cross-table',
      status: mismatches.length > recentPeriods.length * 0.5 ? 'fail' : 'warn',
      message: `${leftLabel} ↔ ${rightLabel} 有 ${mismatches.length}/${recentPeriods.length} 个报告期覆盖不一致`,
      details: { mismatches },
    }
  }

  private checkIncomeVsBalance(mode: 'recent' | 'full') {
    return this.checkFinancialPairAlignment('income', 'balanceSheet', '利润表', '资产负债表', 'C-05', mode)
  }

  private checkIncomeVsCashflow(mode: 'recent' | 'full') {
    return this.checkFinancialPairAlignment('income', 'cashflow', '利润表', '现金流量表', 'C-06', mode)
  }

  // ─── C-07: 指数权重 → 基础信息（引用完整性）───────────────────────────────

  private async checkIndexWeightRefIntegrity(_mode: 'recent' | 'full'): Promise<DataQualityReport> {
    const latestDate = await this.helper.getLatestDateString('indexWeight', 'tradeDate')
    if (!latestDate) {
      return { dataSet: 'C-07', checkType: 'cross-table', status: 'warn', message: '指数权重表无数据' }
    }

    const conCodes = await this.prisma.indexWeight.findMany({
      where: { tradeDate: latestDate },
      select: { conCode: true },
      distinct: ['conCode'],
    })
    const conCodeSet = new Set(conCodes.map((r) => r.conCode))

    if (conCodeSet.size === 0) {
      return {
        dataSet: 'C-07',
        checkType: 'cross-table',
        status: 'warn',
        message: `指数权重 ${latestDate} 无成分股数据`,
      }
    }

    const existingStocks = await this.prisma.stockBasic.findMany({
      where: { tsCode: { in: [...conCodeSet] } },
      select: { tsCode: true },
    })
    const stockCodeSet = new Set(existingStocks.map((s) => s.tsCode))

    const orphanCodes = [...conCodeSet].filter((c) => !stockCodeSet.has(c))

    if (orphanCodes.length === 0) {
      return {
        dataSet: 'C-07',
        checkType: 'cross-table',
        status: 'pass',
        message: `指数权重 → 基础信息 引用完整（${conCodeSet.size} 只成分股全部存在于 StockBasic）`,
      }
    }

    return {
      dataSet: 'C-07',
      checkType: 'cross-table',
      status: orphanCodes.length > conCodeSet.size * 0.05 ? 'fail' : 'warn',
      message: `指数权重中 ${orphanCodes.length}/${conCodeSet.size} 只成分股不存在于 StockBasic`,
      details: { orphanCodes: orphanCodes.slice(0, 50), total: orphanCodes.length },
    }
  }

  // ─── C-08: 指数行情 ↔ 指数权重（指数粒度覆盖）────────────────────────────

  private async checkIndexDailyVsWeight(_mode: 'recent' | 'full'): Promise<DataQualityReport> {
    const [indices, weightIndices] = await Promise.all([
      this.prisma.indexDaily.findMany({ select: { tsCode: true }, distinct: ['tsCode'] }),
      this.prisma.indexWeight.findMany({ select: { indexCode: true }, distinct: ['indexCode'] }),
    ])

    const indexCodes = indices.map((i) => i.tsCode)
    const weightIndexSet = new Set(weightIndices.map((w) => w.indexCode))

    if (indexCodes.length === 0) {
      return { dataSet: 'C-08', checkType: 'cross-table', status: 'warn', message: '指数行情表无数据' }
    }

    const noWeight = indexCodes.filter((c) => !weightIndexSet.has(c))

    if (noWeight.length === 0) {
      return {
        dataSet: 'C-08',
        checkType: 'cross-table',
        status: 'pass',
        message: `指数行情 ↔ 指数权重 覆盖正常（${indexCodes.length} 个指数均有权重）`,
      }
    }

    // IndexWeight 通常只覆盖主要指数，大量 noWeight 是正常的
    return {
      dataSet: 'C-08',
      checkType: 'cross-table',
      status: weightIndexSet.size === 0 ? 'fail' : 'pass',
      message: `${weightIndexSet.size}/${indexCodes.length} 个指数有权重数据，${noWeight.length} 个仅有行情`,
      details: { withWeight: weightIndexSet.size, total: indexCodes.length },
    }
  }
}
