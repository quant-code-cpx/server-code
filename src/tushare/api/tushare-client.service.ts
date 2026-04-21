import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
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

interface ApiChannel {
  queue: Promise<void>
  lastRequestAt: number
}

/**
 * TushareClient — Tushare Pro HTTP 接口底层封装
 *
 * 职责：
 * - 统一发起 HTTP 请求，附带 token
 * - 请求节流（避免触发频控）：每个 API 名称使用独立通道，
 *   同一 API 串行（350ms 间隔），不同 API 可并行
 * - 全局最大并发数限制，防止瞬间打满带宽
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
  /** 全局最大并发请求数（跨所有 API） */
  private readonly globalMaxConcurrency = 5
  private globalConcurrentCount = 0
  /** 每个 API 名称的独立节流通道 */
  private readonly apiChannels = new Map<string, ApiChannel>()

  constructor(private readonly configService: ConfigService) {
    const cfg = this.configService.get<ITushareConfig>(TUSHARE_CONFIG_TOKEN, { infer: true })
    if (!cfg) {
      throw new BusinessException(ErrorEnum.TUSHARE_CONFIG_MISSING)
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
    return this.enqueueRequest(req.api_name, () => this.callWithRetry<T>(req))
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
      clearTimeout(timer)
      if (this.isRetriableNetworkError(err) && attempt <= this.maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 30_000)
        this.logger.warn(
          `Tushare 网络错误 [${req.api_name}] (${(err as Error).message})，第 ${attempt} 次重试，等待 ${delayMs}ms`,
        )
        await this.sleep(delayMs)
        return this.callWithRetry<T>(req, attempt + 1)
      }
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

  /**
   * 将请求入队到对应 API 通道：
   * - 同一 API 串行排队，保证 350ms 节流间隔
   * - 不同 API 可同时进行，但受全局并发数上限限制
   */
  private enqueueRequest<T>(apiName: string, task: () => Promise<T>): Promise<T> {
    if (!this.apiChannels.has(apiName)) {
      this.apiChannels.set(apiName, { queue: Promise.resolve(), lastRequestAt: 0 })
    }
    const channel = this.apiChannels.get(apiName)!

    const queuedTask = async (): Promise<T> => {
      // 在本 API 通道内等待节流间隔
      await this.waitForRequestSlot(channel)
      // 等待全局并发槽位
      await this.acquireGlobalSlot()
      try {
        return await task()
      } finally {
        this.releaseGlobalSlot()
      }
    }

    const result = channel.queue.then(queuedTask, queuedTask)
    channel.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async waitForRequestSlot(channel: ApiChannel) {
    const now = Date.now()
    const waitMs = Math.max(0, this.requestIntervalMs - (now - channel.lastRequestAt))
    if (waitMs > 0) await this.sleep(waitMs)
    channel.lastRequestAt = Date.now()
  }

  private async acquireGlobalSlot() {
    while (this.globalConcurrentCount >= this.globalMaxConcurrency) {
      await this.sleep(50)
    }
    this.globalConcurrentCount++
  }

  private releaseGlobalSlot() {
    this.globalConcurrentCount = Math.max(0, this.globalConcurrentCount - 1)
  }

  private isRetryableRateLimitError(json: TushareResponse) {
    return json.code === 40203 && /每分钟最多访问该接口/.test(json.msg)
  }

  /**
   * 判断 fetch 捕获的异常是否为可重试的网络/超时错误：
   * - AbortError：AbortController.abort() 触发（超时、或 Mac 唤醒后 setTimeout 提前触发）
   * - TypeError: fetch 底层网络错误（DNS 失败、连接被拒、网络中断等）
   */
  private isRetriableNetworkError(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    if (err.name === 'AbortError') return true
    if (err instanceof TypeError) return true
    return false
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
