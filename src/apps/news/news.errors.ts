import { HttpException } from '@nestjs/common'

export const NEWS_ERROR_DEFINITIONS = [
  { code: 7001, key: 'NEWS_ARTICLE_NOT_FOUND', httpStatus: 404, retryable: false, message: '新闻文章不存在' },
  { code: 7002, key: 'NEWS_CURSOR_INVALID', httpStatus: 400, retryable: false, message: '新闻分页游标无效' },
  { code: 7003, key: 'NEWS_CURSOR_EXPIRED', httpStatus: 400, retryable: false, message: '新闻分页游标已过期' },
  { code: 7004, key: 'NEWS_CURSOR_FILTER_MISMATCH', httpStatus: 409, retryable: false, message: '新闻分页条件已变化' },
  { code: 7005, key: 'NEWS_DATE_RANGE_INVALID', httpStatus: 400, retryable: false, message: '新闻日期范围不合法' },
  {
    code: 7006,
    key: 'NEWS_DATE_RANGE_TOO_LARGE',
    httpStatus: 400,
    retryable: false,
    message: '新闻日期范围超过 90 天',
  },
  {
    code: 7007,
    key: 'NEWS_SCOPE_SECURITY_CODES_REQUIRED',
    httpStatus: 400,
    retryable: false,
    message: '指定证券范围必须提供证券代码',
  },
  {
    code: 7008,
    key: 'NEWS_SCOPE_SECURITY_CODES_CONFLICT',
    httpStatus: 400,
    retryable: false,
    message: '当前新闻范围不允许提供证券代码',
  },
  {
    code: 7009,
    key: 'NEWS_PROVIDER_OR_FEED_NOT_FOUND',
    httpStatus: 400,
    retryable: false,
    message: '新闻 Provider 或 Feed 未注册',
  },
  {
    code: 7010,
    key: 'NEWS_PROVIDER_DISABLED',
    httpStatus: 409,
    retryable: false,
    message: '新闻 Provider 或 Feed 已关闭',
  },
  {
    code: 7011,
    key: 'NEWS_INGESTION_COMMAND_NOT_FOUND',
    httpStatus: 404,
    retryable: false,
    message: '新闻采集命令不存在',
  },
  { code: 7012, key: 'NEWS_IDEMPOTENCY_CONFLICT', httpStatus: 409, retryable: false, message: '新闻采集幂等请求冲突' },
  { code: 7013, key: 'NEWS_TEMPORARILY_UNAVAILABLE', httpStatus: 503, retryable: true, message: '新闻服务暂时不可用' },
  { code: 7014, key: 'NEWS_MODULE_DISABLED', httpStatus: 503, retryable: false, message: '新闻模块未启用' },
] as const

export type NewsErrorDefinition = (typeof NEWS_ERROR_DEFINITIONS)[number]
export type NewsErrorKey = NewsErrorDefinition['key']

const NEWS_ERROR_BY_KEY = new Map<NewsErrorKey, NewsErrorDefinition>(
  NEWS_ERROR_DEFINITIONS.map((definition) => [definition.key, definition]),
)

export class NewsHttpException extends HttpException {
  constructor(
    readonly definition: NewsErrorDefinition,
    message: string = definition.message,
    data?: Record<string, unknown>,
  ) {
    super({ code: definition.code, message, data }, definition.httpStatus)
    this.name = NewsHttpException.name
  }

  static fromKey(key: NewsErrorKey, message?: string, data?: Record<string, unknown>): NewsHttpException {
    const definition = NEWS_ERROR_BY_KEY.get(key)
    if (!definition) throw new Error(`未知 News error key: ${key}`)
    return new NewsHttpException(definition, message, data)
  }
}
