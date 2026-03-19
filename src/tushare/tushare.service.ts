import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ITushareConfig, TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'

export interface TushareRequestParams {
  /** Tushare 接口名称，例如 'stock_basic'、'daily' */
  api_name: string
  /** 接口查询参数 */
  params?: Record<string, unknown>
  /** 需要返回的字段，留空则返回全部 */
  fields?: string[]
}

export interface TushareResponse<T = Record<string, unknown>[]> {
  code: number
  msg: string
  data: {
    fields: string[]
    items: unknown[][]
  } | null
  /** 解析后的数据行（由 call() 自动组装） */
  records?: T
}

/**
 * TushareService
 *
 * 封装对 Tushare Pro HTTP 接口的基础调用；
 * 所有数据拉取逻辑均应通过此 service 发起请求。
 *
 * 使用方式（示例）：
 *   const records = await this.tushareService.call({
 *     api_name: 'stock_basic',
 *     params: { exchange: 'SSE', list_status: 'L' },
 *     fields: ['ts_code', 'name', 'industry'],
 *   })
 */
@Injectable()
export class TushareService {
  private readonly logger = new Logger(TushareService.name)
  private readonly token: string
  private readonly baseUrl: string
  private readonly timeout: number

  constructor(private readonly configService: ConfigService) {
    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    if (!cfg) {
      throw new Error(`Tushare config "${TUSHARE_CONFIG_TOKEN}" is not registered.`)
    }
    this.token = cfg.token
    this.baseUrl = cfg.baseUrl
    this.timeout = cfg.timeout
  }

  /**
   * 向 Tushare Pro 发起请求并返回解析后的记录数组。
   *
   * Tushare 返回格式：
   * {
   *   code: 0,
   *   msg: '',
   *   data: { fields: [...], items: [[...], [...]] }
   * }
   * 本方法会将 fields + items 自动组装为 Record<string, unknown>[] 格式。
   */
  async call<T = Record<string, unknown>>(req: TushareRequestParams): Promise<T[]> {
    const body = JSON.stringify({
      api_name: req.api_name,
      token: this.token,
      params: req.params ?? {},
      fields: req.fields ? req.fields.join(',') : '',
    })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    let response: Response
    try {
      response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      })
    } catch (err) {
      this.logger.error(`Tushare 请求失败 [${req.api_name}]: ${(err as Error).message}`)
      throw err
    } finally {
      clearTimeout(timer)
    }

    const json = (await response.json()) as TushareResponse
    if (json.code !== 0) {
      this.logger.error(`Tushare 接口错误 [${req.api_name}] code=${json.code} msg=${json.msg}`)
      throw new Error(`Tushare error: ${json.msg}`)
    }

    return this.parseRecords<T>(json)
  }

  /** 将 Tushare { fields, items } 格式转为对象数组 */
  private parseRecords<T>(json: TushareResponse): T[] {
    if (!json.data) return []
    const { fields, items } = json.data
    return items.map((row) => {
      const record: Record<string, unknown> = {}
      fields.forEach((field, idx) => {
        record[field] = row[idx]
      })
      return record as T
    })
  }
}
