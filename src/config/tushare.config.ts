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
}))

export type ITushareConfig = ConfigType<typeof TushareConfig>
