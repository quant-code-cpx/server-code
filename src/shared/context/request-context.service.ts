import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  /** 请求唯一标识（16 位 hex） */
  traceId: string
  /** 当前用户 ID（JWT 解析后填入） */
  userId?: number
  /** HTTP 方法 */
  method?: string
  /** 请求路径 */
  url?: string
  /** 请求开始时间戳 */
  startTime?: number
}

export class RequestContextService {
  private static readonly storage = new AsyncLocalStorage<RequestContext>()

  /**
   * 在 AsyncLocalStorage 上下文中执行回调。
   * 由中间件在请求入口处调用。
   */
  static run(context: RequestContext, callback: () => void): void {
    this.storage.run(context, callback)
  }

  /** 获取当前请求上下文（可能为 undefined，如非 HTTP 请求场景） */
  static getCurrentContext(): RequestContext | undefined {
    return this.storage.getStore()
  }

  /** 获取当前 traceId 的便捷方法 */
  static getTraceId(): string | undefined {
    return this.storage.getStore()?.traceId
  }

  /** 更新上下文中的 userId（Guard 解析 JWT 后调用） */
  static setUserId(userId: number): void {
    const ctx = this.storage.getStore()
    if (ctx) {
      ctx.userId = userId
    }
  }
}
