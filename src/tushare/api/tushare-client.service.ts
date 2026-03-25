import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ITushareConfig, TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'
import { TushareRequestParams, TushareResponse } from '../tushare.interface'

export class TushareApiError extends Error {
  constructor(
    readonly apiName: string,
    readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'TushareApiError'
  }
}

/**
 * TushareClient — Tushare Pro HTTP 接口底层封装
 *
 * 职责：
 * - 统一发起 HTTP 请求，附带 token
 * - 请求节流（避免触发频控）
 * - 频控 40203 自动重试
 * - 将 { fields, items } 格式解析为对象数组
 */
@Injectable()
export class TushareClient {
  private readonly logger = new Logger(TushareClient.name)
  private readonly token: string
  private readonly baseUrl: string
  private readonly timeout: number
  private readonly requestIntervalMs: number
  private readonly rateLimitRetryDelayMs: number
  private readonly maxRetries: number
  private requestQueue: Promise<void> = Promise.resolve()
  private lastRequestAt = 0

  constructor(private readonly configService: ConfigService) {
    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    if (!cfg) {
      throw new Error(`Tushare config "${TUSHARE_CONFIG_TOKEN}" is not registered.`)
    }
    this.token = cfg.token
    this.baseUrl = cfg.baseUrl
    this.timeout = cfg.timeout
    this.requestIntervalMs = cfg.requestIntervalMs
    this.rateLimitRetryDelayMs = cfg.rateLimitRetryDelayMs
    this.maxRetries = cfg.maxRetries
  }

  /** 向 Tushare Pro 发起请求并返回解析后的记录数组 */
  async call<T = Record<string, unknown>>(req: TushareRequestParams): Promise<T[]> {
    return this.enqueueRequest(() => this.callWithRetry<T>(req))
  }

  private async callWithRetry<T>(req: TushareRequestParams, attempt = 1): Promise<T[]> {
    const body = JSON.stringify({
      api_name: req.api_name,
      token: this.token,
      params: req.params ?? {},
      fields: req.fields ? req.fields.join(',') : '',
      ...(req.limit !== undefined ? { limit: req.limit } : {}),
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
    if (this.isRetryableRateLimitError(json) && attempt <= this.maxRetries) {
      this.logger.warn(`Tushare 频控 [${req.api_name}]，第 ${attempt} 次重试，等待 ${this.rateLimitRetryDelayMs}ms`)
      await this.sleep(this.rateLimitRetryDelayMs)
      return this.callWithRetry<T>(req, attempt + 1)
    }

    if (json.code !== 0) {
      this.logger.error(`Tushare 错误 [${req.api_name}] code=${json.code} msg=${json.msg}`)
      throw new TushareApiError(req.api_name, json.code, `Tushare error: ${json.msg}`)
    }

    return this.parseRecords<T>(json)
  }

  private enqueueRequest<T>(task: () => Promise<T>): Promise<T> {
    const queuedTask = async () => {
      await this.waitForRequestSlot()
      return task()
    }
    const result = this.requestQueue.then(queuedTask, queuedTask)
    this.requestQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async waitForRequestSlot() {
    const now = Date.now()
    const waitMs = Math.max(0, this.requestIntervalMs - (now - this.lastRequestAt))
    if (waitMs > 0) await this.sleep(waitMs)
    this.lastRequestAt = Date.now()
  }

  private isRetryableRateLimitError(json: TushareResponse) {
    return json.code === 40203 && /每分钟最多访问该接口/.test(json.msg)
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

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
