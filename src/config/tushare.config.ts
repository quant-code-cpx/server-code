import { ConfigType, registerAs } from '@nestjs/config'
import {
  TUSHARE_DEFAULT_SYNC_START_DATE,
  TUSHARE_SYNC_CRON,
  TUSHARE_SYNC_TIME_ZONE,
} from 'src/constant/tushare.constant'

export const TUSHARE_CONFIG_TOKEN = 'tushare'

export const TushareConfig = registerAs(TUSHARE_CONFIG_TOKEN, () => ({
  /** Tushare Pro API token，从 https://tushare.pro 获取 */
  token: process.env.TUSHARE_TOKEN || '',
  /** Tushare Pro 接口地址 */
  baseUrl: process.env.TUSHARE_BASE_URL || 'http://api.tushare.pro',
  /** 单次请求超时（毫秒） */
  timeout: parseInt(process.env.TUSHARE_TIMEOUT, 10) || 10000,
  /** 请求节流间隔（毫秒），用于规避积分档位频控 */
  requestIntervalMs: parseInt(process.env.TUSHARE_REQUEST_INTERVAL_MS ?? '', 10) || 350,
  /** 命中频控后的重试等待时间（毫秒） */
  rateLimitRetryDelayMs: parseInt(process.env.TUSHARE_RATE_LIMIT_RETRY_DELAY_MS ?? '', 10) || 65000,
  /** 单次请求命中频控后的最大重试次数 */
  maxRetries: parseInt(process.env.TUSHARE_MAX_RETRIES ?? '', 10) || 3,
  /** 是否启用启动检测与定时同步 */
  syncEnabled: process.env.TUSHARE_SYNC_ENABLED !== 'false',
  /** 历史补数起始日期（YYYYMMDD） */
  syncStartDate: process.env.TUSHARE_SYNC_START_DATE || TUSHARE_DEFAULT_SYNC_START_DATE,
  /** 每日定时同步 Cron，默认交易日 18:30 由服务内部再结合交易日历判断 */
  syncCron: process.env.TUSHARE_SYNC_CRON || TUSHARE_SYNC_CRON,
  /** 定时任务时区 */
  syncTimeZone: process.env.TUSHARE_SYNC_TIME_ZONE || TUSHARE_SYNC_TIME_ZONE,
  /** 同步分类间最大并发数（1 = 串行，默认 3；同分类内始终串行以遵守频控） */
  syncConcurrency: parseInt(process.env.TUSHARE_SYNC_CONCURRENCY ?? '', 10) || 3,
  /** 按日期并发同步时每批日期数（1 = 串行，默认 1，推荐 3-5） */
  dateBatchConcurrency: parseInt(process.env.TUSHARE_DATE_BATCH_CONCURRENCY ?? '', 10) || 1,
  /**
   * 是否在应用启动时运行 bootstrap 同步。
   * 默认：生产环境 true，开发环境 false（防止 nest start --watch 热更新时反复触发全量同步）。
   * 可通过 TUSHARE_BOOTSTRAP_ON_START=true/false 显式覆盖。
   */
  bootstrapOnStart:
    process.env.TUSHARE_BOOTSTRAP_ON_START !== undefined
      ? process.env.TUSHARE_BOOTSTRAP_ON_START !== 'false'
      : process.env.NODE_ENV !== 'development',
}))

export type ITushareConfig = ConfigType<typeof TushareConfig>
