import { Injectable, Logger } from '@nestjs/common'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { TushareSyncExecutionStatus, TushareSyncTaskName } from 'src/constant/tushare.constant'
import { FundApiService } from '../api/fund-api.service'
import {
  mapFundBasicRecord,
  mapFundDailyRecord,
  mapFundNavRecord,
  mapFundPortfolioRecord,
  mapFundShareRecord,
} from '../tushare-sync.mapper'
import { SyncHelperService } from './sync-helper.service'
import { TushareSyncMode, TushareSyncPlan, TushareSyncPlanContext } from './sync-plan.types'
import { ValidationCollector } from './quality/validation-collector'

/**
 * FundSyncService — 基金数据同步
 *
 * 包含：基金列表 / 基金净值 / ETF 日线行情 / 基金持仓 / 基金份额
 *
 * 策略：
 * - fund_basic: 全量替换（场内+场外各一次请求）
 * - fund_nav: 按代码逐只增量（仅场内 ETF/LOF）
 * - fund_daily: 按交易日增量（同 DAILY 模式）
 * - fund_portfolio: 按基金代码逐只增量（仅场内 ETF/LOF）
 * - fund_share: 按基金代码逐只增量（仅场内 ETF/LOF）
 */
@Injectable()
export class FundSyncService {
  private readonly logger = new Logger(FundSyncService.name)

  constructor(
    private readonly api: FundApiService,
    private readonly helper: SyncHelperService,
  ) {}

  getSyncPlans(): TushareSyncPlan[] {
    return [
      {
        task: TushareSyncTaskName.FUND_BASIC,
        label: '基金列表',
        category: 'fund',
        order: 510,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 9 * * 1',
          timeZone: this.helper.syncTimeZone,
          description: '每周一刷新基金列表',
        },
        execute: () => this.syncFundBasic(),
      },
      {
        task: TushareSyncTaskName.FUND_NAV,
        label: '基金净值',
        category: 'fund',
        order: 520,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 21 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '每个工作日晚间同步基金净值',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncFundNav(ctx),
      },
      {
        task: TushareSyncTaskName.FUND_DAILY,
        label: 'ETF日线行情',
        category: 'fund',
        order: 530,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: true,
        schedule: {
          cron: '0 30 18 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '交易日盘后同步 ETF 日线',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncFundDaily(ctx),
      },
      {
        task: TushareSyncTaskName.FUND_SHARE,
        label: '基金份额',
        category: 'fund',
        order: 535,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 22 * * 1-5',
          timeZone: this.helper.syncTimeZone,
          description: '每个工作日晚间同步基金份额变动',
          tradingDayOnly: true,
        },
        execute: (ctx) => this.syncFundShare(ctx),
      },
      {
        task: TushareSyncTaskName.FUND_PORTFOLIO,
        label: '基金持仓',
        category: 'fund',
        order: 540,
        bootstrapEnabled: true,
        supportsManual: true,
        supportsFullSync: true,
        requiresTradeDate: false,
        schedule: {
          cron: '0 0 4 1 * *',
          timeZone: this.helper.syncTimeZone,
          description: '每月1日凌晨同步公募基金季度持仓',
        },
        execute: (ctx) => this.syncFundPortfolio(ctx),
      },
    ]
  }

  // ─── 基金列表 ──────────────────────────────────────────────────────────────

  async syncFundBasic(): Promise<void> {
    const startedAt = new Date()
    this.logger.log('[基金列表] 开始全量同步...')

    const collector = new ValidationCollector(TushareSyncTaskName.FUND_BASIC)

    // 分别拉取场内和场外
    const [exchangeRows, ofRows] = await Promise.all([this.api.getFundBasic('E'), this.api.getFundBasic('O')])

    const allRows = [...exchangeRows, ...ofRows]
    const mapped = allRows
      .map((r) => mapFundBasicRecord(r, collector))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))

    const count = await this.helper.replaceAllRows('fundBasic', mapped)

    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[基金列表] 同步完成，共 ${count} 条（场内 ${exchangeRows.length}，场外 ${ofRows.length}）`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.FUND_BASIC,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `基金列表同步完成，共 ${count} 条`,
        payload: { rowCount: count, exchangeCount: exchangeRows.length, ofCount: ofRows.length },
      },
      startedAt,
    )
  }

  // ─── 基金净值（按代码逐只增量）────────────────────────────────────────────

  async syncFundNav(ctx?: TushareSyncPlanContext): Promise<void> {
    const isFullSync = ctx?.mode === 'full'
    const startedAt = new Date()
    this.logger.log(`[基金净值] 开始同步...${isFullSync ? '（全量模式）' : ''}`)

    // 从 fund_basic 表获取场内基金代码列表
    const fundList = await this.helper.prisma.fundBasic.findMany({
      where: { market: 'E' },
      select: { tsCode: true },
    })
    const tsCodes: string[] = fundList.map((f: { tsCode: string }) => f.tsCode)

    if (!tsCodes.length) {
      this.logger.warn('[基金净值] fund_basic 中无场内基金，请先同步基金列表')
      return
    }

    this.logger.log(`[基金净值] 待同步 ${tsCodes.length} 只场内基金`)

    // 断点续传
    const resumeKey = isFullSync ? null : await this.helper.getResumeKey(TushareSyncTaskName.FUND_NAV)
    let startIndex = 0
    if (resumeKey) {
      const idx = tsCodes.indexOf(resumeKey)
      if (idx >= 0) {
        startIndex = idx + 1
        this.logger.log(`[基金净值] 从断点续传: ${resumeKey} (index=${startIndex})`)
      }
    }

    const collector = new ValidationCollector(TushareSyncTaskName.FUND_NAV)
    let totalRows = 0
    const failed: Array<{ tsCode: string; error: string }> = []

    for (let i = startIndex; i < tsCodes.length; i++) {
      const tsCode = tsCodes[i]
      try {
        // 增量：获取该基金最新净值日期
        let startDate: string | undefined
        if (!isFullSync) {
          const latest = await this.helper.prisma.fundNav.findFirst({
            where: { tsCode },
            orderBy: { navDate: 'desc' },
            select: { navDate: true },
          })
          if (latest) {
            startDate = this.helper.addDays(this.helper.formatDate(latest.navDate), 1)
          }
        }

        const rows = await this.api.getFundNavByTsCode(tsCode, startDate)
        if (rows.length > 0) {
          const mapped = rows
            .map((r) => mapFundNavRecord(r, collector))
            .filter((r): r is NonNullable<typeof r> => Boolean(r))

          if (mapped.length > 0) {
            const result = await this.helper.prisma.fundNav.createMany({
              data: mapped,
              skipDuplicates: true,
            })
            totalRows += result.count
          }
        }

        // 每 50 只更新断点
        if ((i + 1) % 50 === 0 || i === tsCodes.length - 1) {
          await this.helper.updateProgress(TushareSyncTaskName.FUND_NAV, tsCode, i + 1, tsCodes.length)
          ctx?.onProgress?.(i + 1, tsCodes.length, tsCode)
          this.logger.log(`[基金净值] 进度 ${i + 1}/${tsCodes.length}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[基金净值] ${tsCode} 同步失败: ${msg}`)
        failed.push({ tsCode, error: msg })
      }
    }

    await this.helper.markCompleted(TushareSyncTaskName.FUND_NAV)
    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[基金净值] 同步完成，共 ${totalRows} 条${failed.length ? `，${failed.length} 只失败` : ''}`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.FUND_NAV,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `基金净值同步完成，共 ${totalRows} 条`,
        payload: {
          rowCount: totalRows,
          fundCount: tsCodes.length,
          failedFunds: failed.length > 0 ? failed : undefined,
        },
      },
      startedAt,
    )
  }

  // ─── ETF 日线行情（按交易日增量）──────────────────────────────────────────

  async syncFundDaily(ctx: TushareSyncPlanContext): Promise<void> {
    const targetTradeDate = this.requireTradeDate(ctx.targetTradeDate)
    const isFullSync = ctx.mode === 'full'
    const startedAt = new Date()

    if (!isFullSync && (await this.helper.isTaskSyncedForTradeDate(TushareSyncTaskName.FUND_DAILY, targetTradeDate))) {
      this.logger.log(`[ETF日线] 目标交易日 ${targetTradeDate} 已同步，跳过`)
      return
    }

    const latestDate = isFullSync ? null : await this.helper.getLatestDateString('fundDaily')
    const startDate = latestDate ? this.helper.addDays(latestDate, 1) : this.helper.syncStartDate

    if (this.helper.compareDateString(startDate, targetTradeDate) > 0) {
      this.logger.log('[ETF日线] 已是最新，无需同步')
      return
    }

    const tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, targetTradeDate)
    if (!tradeDates.length) {
      this.logger.log('[ETF日线] 无交易日，跳过')
      return
    }

    this.logger.log(`[ETF日线] 开始同步 ${tradeDates.length} 个交易日`)
    const collector = new ValidationCollector(TushareSyncTaskName.FUND_DAILY)
    let totalRows = 0

    for (const [i, td] of tradeDates.entries()) {
      const rows = await this.api.getFundDailyByTradeDate(td)
      const mapped = rows
        .map((r) => mapFundDailyRecord(r, collector))
        .filter((r): r is NonNullable<typeof r> => Boolean(r))

      totalRows += await this.helper.replaceTradeDateRows('fundDaily', this.helper.toDate(td), mapped)

      if (i === 0 || (i + 1) % 50 === 0 || i === tradeDates.length - 1) {
        ctx.onProgress?.(i + 1, tradeDates.length, td)
        this.logger.log(`[ETF日线] 进度 ${i + 1}/${tradeDates.length}，当前 ${td}，累计 ${totalRows} 条`)
      }
    }

    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[ETF日线] 同步完成，共 ${totalRows} 条`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.FUND_DAILY,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `ETF日线同步完成，共 ${totalRows} 条`,
        tradeDate: this.helper.toDate(tradeDates[tradeDates.length - 1]),
        payload: { rowCount: totalRows, dateCount: tradeDates.length },
      },
      startedAt,
    )
  }

  private requireTradeDate(targetTradeDate?: string): string {
    if (!targetTradeDate) {
      throw new BusinessException(ErrorEnum.TUSHARE_TARGET_TRADE_DATE_REQUIRED)
    }
    return targetTradeDate
  }

  // ─── 基金份额（按代码逐只增量）──────────────────────────────────────────────

  async syncFundShare(ctx?: TushareSyncPlanContext): Promise<void> {
    const isFullSync = ctx?.mode === 'full'
    const startedAt = new Date()
    this.logger.log(`[基金份额] 开始同步...${isFullSync ? '（全量模式）' : ''}`)

    const fundList = await this.helper.prisma.fundBasic.findMany({
      where: { market: 'E' },
      select: { tsCode: true },
    })
    const tsCodes: string[] = fundList.map((f: { tsCode: string }) => f.tsCode)

    if (!tsCodes.length) {
      this.logger.warn('[基金份额] fund_basic 中无场内基金，请先同步基金列表')
      return
    }

    this.logger.log(`[基金份额] 待同步 ${tsCodes.length} 只场内基金`)

    const resumeKey = isFullSync ? null : await this.helper.getResumeKey(TushareSyncTaskName.FUND_SHARE)
    let startIndex = 0
    if (resumeKey) {
      const idx = tsCodes.indexOf(resumeKey)
      if (idx >= 0) {
        startIndex = idx + 1
        this.logger.log(`[基金份额] 从断点续传: ${resumeKey} (index=${startIndex})`)
      }
    }

    const collector = new ValidationCollector(TushareSyncTaskName.FUND_SHARE)
    let totalRows = 0
    const failed: Array<{ tsCode: string; error: string }> = []

    for (let i = startIndex; i < tsCodes.length; i++) {
      const tsCode = tsCodes[i]
      try {
        let startDate: string | undefined
        if (!isFullSync) {
          const latest = await this.helper.prisma.fundShare.findFirst({
            where: { tsCode },
            orderBy: { tradeDate: 'desc' },
            select: { tradeDate: true },
          })
          if (latest) {
            startDate = this.helper.addDays(this.helper.formatDate(latest.tradeDate), 1)
          }
        }

        const rows = await this.api.getFundShareByTsCode(tsCode, startDate)
        if (rows.length > 0) {
          const mapped = rows
            .map((r) => mapFundShareRecord(r, collector))
            .filter((r): r is NonNullable<typeof r> => Boolean(r))

          if (mapped.length > 0) {
            const result = await this.helper.prisma.fundShare.createMany({
              data: mapped,
              skipDuplicates: true,
            })
            totalRows += result.count
          }
        }

        if ((i + 1) % 50 === 0 || i === tsCodes.length - 1) {
          await this.helper.updateProgress(TushareSyncTaskName.FUND_SHARE, tsCode, i + 1, tsCodes.length)
          ctx?.onProgress?.(i + 1, tsCodes.length, tsCode)
          this.logger.log(`[基金份额] 进度 ${i + 1}/${tsCodes.length}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[基金份额] ${tsCode} 同步失败: ${msg}`)
        failed.push({ tsCode, error: msg })
      }
    }

    await this.helper.markCompleted(TushareSyncTaskName.FUND_SHARE)
    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[基金份额] 同步完成，共 ${totalRows} 条${failed.length ? `，${failed.length} 只失败` : ''}`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.FUND_SHARE,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `基金份额同步完成，共 ${totalRows} 条`,
        payload: {
          rowCount: totalRows,
          fundCount: tsCodes.length,
          failedFunds: failed.length > 0 ? failed : undefined,
        },
      },
      startedAt,
    )
  }

  // ─── 基金持仓（按代码逐只增量）──────────────────────────────────────────────

  async syncFundPortfolio(ctx?: TushareSyncPlanContext): Promise<void> {
    const isFullSync = ctx?.mode === 'full'
    const startedAt = new Date()
    this.logger.log(`[基金持仓] 开始同步...${isFullSync ? '（全量模式）' : ''}`)

    const fundList = await this.helper.prisma.fundBasic.findMany({
      where: { market: 'E' },
      select: { tsCode: true },
    })
    const tsCodes: string[] = fundList.map((f: { tsCode: string }) => f.tsCode)

    if (!tsCodes.length) {
      this.logger.warn('[基金持仓] fund_basic 中无场内基金，请先同步基金列表')
      return
    }

    this.logger.log(`[基金持仓] 待同步 ${tsCodes.length} 只场内基金`)

    const resumeKey = isFullSync ? null : await this.helper.getResumeKey(TushareSyncTaskName.FUND_PORTFOLIO)
    let startIndex = 0
    if (resumeKey) {
      const idx = tsCodes.indexOf(resumeKey)
      if (idx >= 0) {
        startIndex = idx + 1
        this.logger.log(`[基金持仓] 从断点续传: ${resumeKey} (index=${startIndex})`)
      }
    }

    const collector = new ValidationCollector(TushareSyncTaskName.FUND_PORTFOLIO)
    let totalRows = 0
    const failed: Array<{ tsCode: string; error: string }> = []

    for (let i = startIndex; i < tsCodes.length; i++) {
      const tsCode = tsCodes[i]
      try {
        let startDate: string | undefined
        if (!isFullSync) {
          const latest = await this.helper.prisma.fundPortfolio.findFirst({
            where: { tsCode },
            orderBy: { endDate: 'desc' },
            select: { endDate: true },
          })
          if (latest) {
            // 持仓数据按季度更新，从最新报告期的后一天开始
            startDate = this.helper.addDays(this.helper.formatDate(latest.endDate), 1)
          }
        }

        const rows = await this.api.getFundPortfolioByTsCode(tsCode, startDate)
        if (rows.length > 0) {
          const mapped = rows
            .map((r) => mapFundPortfolioRecord(r, collector))
            .filter((r): r is NonNullable<typeof r> => Boolean(r))

          if (mapped.length > 0) {
            const result = await this.helper.prisma.fundPortfolio.createMany({
              data: mapped,
              skipDuplicates: true,
            })
            totalRows += result.count
          }
        }

        if ((i + 1) % 50 === 0 || i === tsCodes.length - 1) {
          await this.helper.updateProgress(TushareSyncTaskName.FUND_PORTFOLIO, tsCode, i + 1, tsCodes.length)
          ctx?.onProgress?.(i + 1, tsCodes.length, tsCode)
          this.logger.log(`[基金持仓] 进度 ${i + 1}/${tsCodes.length}，累计 ${totalRows} 条`)
        }
      } catch (error) {
        const msg = (error as Error).message
        this.logger.error(`[基金持仓] ${tsCode} 同步失败: ${msg}`)
        failed.push({ tsCode, error: msg })
      }
    }

    await this.helper.markCompleted(TushareSyncTaskName.FUND_PORTFOLIO)
    await this.helper.flushValidationLogs(collector)
    this.logger.log(`[基金持仓] 同步完成，共 ${totalRows} 条${failed.length ? `，${failed.length} 只失败` : ''}`)
    await this.helper.writeSyncLog(
      TushareSyncTaskName.FUND_PORTFOLIO,
      {
        status: TushareSyncExecutionStatus.SUCCESS,
        message: `基金持仓同步完成，共 ${totalRows} 条`,
        payload: {
          rowCount: totalRows,
          fundCount: tsCodes.length,
          failedFunds: failed.length > 0 ? failed : undefined,
        },
      },
      startedAt,
    )
  }
}
