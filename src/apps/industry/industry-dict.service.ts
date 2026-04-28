import { Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { CACHE_NAMESPACE } from 'src/constant/cache.constant'
import { CacheService } from 'src/shared/cache.service'
import { PrismaService } from 'src/shared/prisma.service'
import { IndustryDictMappingQueryDto } from './dto/industry-dict-query.dto'
import type {
  IndustryDictMappingResponseDto,
  IndustryDictMappingItemDto,
} from './dto/industry-dict-response.dto'

dayjs.extend(utc)
dayjs.extend(timezone)

const DICT_CACHE_TTL = 24 * 3600 // 24h

@Injectable()
export class IndustryDictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  async getDictMapping(query: IndustryDictMappingQueryDto): Promise<IndustryDictMappingResponseDto> {
    const cacheKey = this.cacheService.buildKey('industry:dict-mapping', {
      source: query.source,
      target: query.target,
    })

    return this.rememberCache(cacheKey, DICT_CACHE_TTL, async () => {
      // Step 1: 申万 L1 行业
      const swRows = await this.prisma.$queryRawUnsafe<{ index_code: string; industry_name: string; src: string | null }[]>(
        `SELECT index_code, industry_name, src
         FROM sw_industry_classification
         WHERE level = 'L1'`,
      )

      // Step 2: 最新交易日东财行业板块
      const dcRows = await this.prisma.$queryRawUnsafe<{ ts_code: string; board_code: string; name: string; trade_date: Date }[]>(
        `WITH latest_dc AS (
           SELECT MAX(trade_date) AS trade_date
           FROM sector_capital_flows
           WHERE content_type = '行业'
         )
         SELECT DISTINCT
           scf.ts_code,
           regexp_replace(scf.ts_code, '\\.DC$', '') AS board_code,
           scf.name,
           (SELECT trade_date FROM latest_dc) AS trade_date
         FROM sector_capital_flows scf
         WHERE scf.content_type = '行业'
           AND scf.trade_date = (SELECT trade_date FROM latest_dc)
           AND scf.name IS NOT NULL`,
      )

      const latestTradeDate = dcRows.length > 0 ? dcRows[0].trade_date : null
      const version = swRows.length > 0 ? (swRows[0].src ?? null) : null

      // 构建东财 name → row 索引（去重：同名取第一个）
      const dcByName = new Map<string, (typeof dcRows)[number]>()
      for (const dc of dcRows) {
        if (!dcByName.has(dc.name)) {
          dcByName.set(dc.name, dc)
        }
      }

      // Step 3: 精确匹配
      const items: IndustryDictMappingItemDto[] = []
      let matched = 0

      for (const sw of swRows) {
        const dc = dcByName.get(sw.industry_name)
        if (dc) {
          matched++
          items.push({
            swCode: sw.index_code,
            swName: sw.industry_name,
            dcTsCode: dc.ts_code,
            dcBoardCode: dc.board_code,
            dcName: dc.name,
            matchType: 'exact',
            confidence: 1,
          })
        } else if (query.includeUnmatched !== false) {
          items.push({
            swCode: sw.index_code,
            swName: sw.industry_name,
            dcTsCode: null,
            dcBoardCode: null,
            dcName: null,
            matchType: 'none',
            confidence: 0,
          })
        }
      }

      // Step 4: 上市股票覆盖率
      const stockCountRows = await this.prisma.$queryRawUnsafe<{ total: bigint; mapped: bigint }[]>(
        `SELECT
           COUNT(*) AS total,
           COUNT(sw.l1_code) AS mapped
         FROM stock_basic_profiles sb
         LEFT JOIN (
           SELECT DISTINCT ON (ts_code) ts_code, l1_code
           FROM sw_industry_members
           WHERE is_new = 'Y'
           ORDER BY ts_code, in_date DESC NULLS LAST
         ) sw ON sw.ts_code = sb.ts_code
         WHERE sb.list_status = 'L'`,
      )

      const listedStockCount = stockCountRows.length > 0 ? Number(stockCountRows[0].total) : 0
      const listedStockMappedCount = stockCountRows.length > 0 ? Number(stockCountRows[0].mapped) : 0
      const total = swRows.length
      const unmatched = total - matched

      return {
        source: 'sw_l1',
        target: 'dc_industry',
        version,
        tradeDate: latestTradeDate ? this.formatDateStr(latestTradeDate) : null,
        coverage: {
          total,
          matched,
          unmatched,
          matchRate: total > 0 ? Math.round((matched / total) * 10000) / 10000 : 0,
          listedStockCount,
          listedStockMappedCount,
          listedStockMappedRate:
            listedStockCount > 0
              ? Math.round((listedStockMappedCount / listedStockCount) * 10000) / 10000
              : 0,
        },
        items,
      }
    })
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  private formatDateStr(date: Date): string {
    return dayjs(date).tz('Asia/Shanghai').format('YYYYMMDD')
  }

  private rememberCache<T>(key: string, ttlSeconds: number, loader: () => Promise<T>) {
    return this.cacheService.rememberJson({
      namespace: CACHE_NAMESPACE.INDUSTRY,
      key,
      ttlSeconds,
      loader,
    })
  }
}
