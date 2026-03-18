import { ConfigType, registerAs } from '@nestjs/config'

export const TUSHARE_CONFIG_TOKEN = 'tushare'

export const TushareConfig = registerAs(TUSHARE_CONFIG_TOKEN, () => ({
  /** Tushare Pro API token，从 https://tushare.pro 获取 */
  token: process.env.TUSHARE_TOKEN || '',
  /** Tushare Pro 接口地址 */
  baseUrl: process.env.TUSHARE_BASE_URL || 'http://api.tushare.pro',
  /** 单次请求超时（毫秒） */
  timeout: parseInt(process.env.TUSHARE_TIMEOUT, 10) || 10000,
}))

export type ITushareConfig = ConfigType<typeof TushareConfig>
