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
