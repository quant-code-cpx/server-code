import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { HeatmapService } from './heatmap.service'
import { HeatmapItemDto } from './dto/heatmap-response.dto'
import { HeatmapHistoryQueryDto } from './dto/heatmap-history-query.dto'

/** 历史热力图快照查询响应结构 */
export interface HeatmapHistoryResponse {
  tradeDate: string
  groupBy: string
  stockCount: number
  /** true = 读快照；false = 实时计算后已写入快照 */
  isFromSnapshot: boolean
  items: HeatmapItemDto[]
}

/** 支持快照聚合的维度列表 */
const SNAPSHOT_DIMENSIONS: Array<{ groupBy: string; indexCode?: string }> = [
  { groupBy: 'industry' },
  { groupBy: 'index', indexCode: '000300.SH' }, // 沪深300
  { groupBy: 'index', indexCode: '000905.SH' }, // 中证500
  { groupBy: 'index', indexCode: '000016.SH' }, // 上证50
  { groupBy: 'index', indexCode: '399006.SZ' }, // 创业板指
  { groupBy: 'index', indexCode: '000852.SH' }, // 中证1000
]

@Injectable()
export class HeatmapSnapshotService {
  private readonly logger = new Logger(HeatmapSnapshotService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly heatmapService: HeatmapService,
  ) {}

  /**
   * 聚合指定交易日的热力图快照，写入 heatmap_snapshots 表。
   *
   * 调用时机：
   *   1. TushareSyncService 每日同步完成后自动调用
   *   2. 管理端 POST /heatmap/snapshot/trigger 手动触发
   *
   * 流程：
   *   对每个维度（industry + 5 个指数）：
   *     1. 调用 HeatmapService.getHeatmap() 获取实时数据
   *     2. 批量 upsert 到 heatmap_snapshots（按主键 [tradeDate, groupBy, tsCode] 去重）
   *     3. 写入 heatmap_snapshot_statuses 状态记录
   *
   * @param tradeDate  格式 YYYYMMDD；留空时取最新交易日
   */
  async aggregateSnapshot(tradeDate?: string): Promise<{ tradeDate: string; totalRecords: number }> {
    const resolvedDate = tradeDate ?? (await this.getLatestTradeDate())
    this.logger.log(`开始聚合热力图快照，交易日：${resolvedDate}`)

    let totalRecords = 0

    for (const dim of SNAPSHOT_DIMENSIONS) {
      const groupByKey = dim.indexCode ? `${dim.groupBy}:${dim.indexCode}` : dim.groupBy
      const groupByStored = dim.indexCode ?? dim.groupBy
      try {
        const items = await this.heatmapService.getHeatmap({
          trade_date: resolvedDate,
          group_by: dim.groupBy as 'industry' | 'index' | 'concept',
          index_code: dim.indexCode,
        })

        if (items.length === 0) {
          this.logger.warn(`维度 ${groupByKey} 在 ${resolvedDate} 无数据，跳过`)
          continue
        }

        // 批量 upsert，每批 500 条
        const BATCH_SIZE = 500
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
          const batch = items.slice(i, i + BATCH_SIZE)
          await this.prisma.$transaction(
            batch.map((item) =>
              this.prisma.heatmapSnapshot.upsert({
                where: {
                  tradeDate_groupBy_tsCode: {
                    tradeDate: resolvedDate,
                    groupBy: groupByStored,
                    tsCode: item.tsCode,
                  },
                },
                create: {
                  tradeDate: resolvedDate,
                  groupBy: groupByStored,
                  groupName: item.groupName ?? item.industry ?? '',
                  tsCode: item.tsCode,
                  name: item.name ?? undefined,
                  pctChg: item.pctChg ?? undefined,
                  totalMv: item.totalMv ?? undefined,
                  amount: item.amount ?? undefined,
                },
                update: {
                  groupName: item.groupName ?? item.industry ?? '',
                  name: item.name ?? undefined,
                  pctChg: item.pctChg ?? undefined,
                  totalMv: item.totalMv ?? undefined,
                  amount: item.amount ?? undefined,
                },
              }),
            ),
          )
        }

        // 写入聚合状态
        await this.prisma.heatmapSnapshotStatus.upsert({
          where: { tradeDate_groupBy: { tradeDate: resolvedDate, groupBy: groupByStored } },
          create: {
            tradeDate: resolvedDate,
            groupBy: groupByStored,
            stockCount: items.length,
            isComplete: true,
            aggregatedAt: new Date(),
          },
          update: {
            stockCount: items.length,
            isComplete: true,
            aggregatedAt: new Date(),
          },
        })

        totalRecords += items.length
        this.logger.log(`维度 ${groupByKey} 聚合完成，写入 ${items.length} 条记录`)
      } catch (err) {
        this.logger.error(`维度 ${groupByKey} 聚合失败：${(err as Error).message}`)
        // 写入失败状态
        await this.prisma.heatmapSnapshotStatus.upsert({
          where: { tradeDate_groupBy: { tradeDate: resolvedDate, groupBy: groupByStored } },
          create: {
            tradeDate: resolvedDate,
            groupBy: groupByStored,
            stockCount: 0,
            isComplete: false,
            aggregatedAt: new Date(),
          },
          update: { isComplete: false, aggregatedAt: new Date() },
        })
      }
    }

    this.logger.log(`热力图快照聚合完成，共写入 ${totalRecords} 条，交易日：${resolvedDate}`)
    return { tradeDate: resolvedDate, totalRecords }
  }

  /**
   * 查询指定日期和维度的热力图快照数据。
   * 优先读 heatmap_snapshots 快照表，若快照不存在则降级为实时计算并异步写入快照。
   */
  async queryHistory(dto: HeatmapHistoryQueryDto): Promise<HeatmapHistoryResponse> {
    const groupBy = dto.group_by ?? 'industry'
    const tradeDate = dto.trade_date

    // 1. 先查快照状态
    const status = await this.prisma.heatmapSnapshotStatus.findUnique({
      where: { tradeDate_groupBy: { tradeDate, groupBy } },
    })

    if (status?.isComplete) {
      // 2a. 快照存在，直接读取
      const rows = await this.prisma.heatmapSnapshot.findMany({
        where: { tradeDate, groupBy },
        orderBy: [{ groupName: 'asc' }, { totalMv: 'desc' }],
      })
      return {
        tradeDate,
        groupBy,
        stockCount: rows.length,
        isFromSnapshot: true,
        items: rows.map((r) => ({
          tsCode: r.tsCode,
          name: r.name,
          groupName: r.groupName,
          industry: r.groupName, // 兼容旧字段
          pctChg: r.pctChg ? Number(r.pctChg) : null,
          totalMv: r.totalMv ? Number(r.totalMv) : null,
          amount: r.amount ? Number(r.amount) : null,
        })),
      }
    }

    // 2b. 快照不存在，降级为实时计算并异步写入快照
    const { group_by: gby, index_code } = this.parseGroupBy(groupBy)
    const items = await this.heatmapService.getHeatmap({
      trade_date: tradeDate,
      group_by: gby as 'industry' | 'index' | 'concept',
      index_code,
    })
    // 异步写入快照（不阻塞响应）
    this.aggregateSnapshot(tradeDate).catch((err) =>
      this.logger.warn(`历史快照降级写入失败：${(err as Error).message}`),
    )

    return {
      tradeDate,
      groupBy,
      stockCount: items.length,
      isFromSnapshot: false,
      items,
    }
  }

  private async getLatestTradeDate(): Promise<string> {
    const latest = await this.prisma.daily.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latest) throw new Error('暂无日线行情数据，无法确定最新交易日')
    const d = latest.tradeDate
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  }

  /** 将存储格式的 groupBy 解析为 HeatmapQueryDto 参数 */
  private parseGroupBy(groupBy: string): { group_by: string; index_code?: string } {
    if (/^\d{6}\.(SH|SZ)$/.test(groupBy)) {
      return { group_by: 'index', index_code: groupBy }
    }
    return { group_by: groupBy }
  }
}
