/**
 * TushareClient — 单元测试
 *
 * 覆盖要点：
 * - call() 将 { fields, items } 正确解析为对象数组
 * - call() 当 items 为空时返回空数组
 * - call() 在 code !== 0 时抛出 TushareApiError
 * - call() 命中频控（code=40203）自动重试
 * - call() 超过 maxRetries 后停止重试
 * - call() 在 fetch 网络异常时向上抛出
 * - parseRecords 私有方法可通过 (client as any) 直接调用
 */

import { ConfigService } from '@nestjs/config'
import { TushareApiError, TushareClient } from '../tushare-client.service'
import { TUSHARE_CONFIG_TOKEN } from 'src/config/tushare.config'

// ── 测试配置 ───────────────────────────────────────────────────────────────────

const MOCK_CONFIG = {
  token: 'test-token',
  baseUrl: 'https://api.tushare.pro',
  timeout: 5000,
  requestIntervalMs: 0,
  rateLimitRetryDelayMs: 0,
  maxRetries: 2,
}

// ── mock 工厂 ─────────────────────────────────────────────────────────────────

function buildMockConfigService(): ConfigService {
  // @ts-ignore
  return {
    get: jest.fn((token: string) => {
      if (token === TUSHARE_CONFIG_TOKEN) return MOCK_CONFIG
      return undefined
    }),
  } as unknown as ConfigService
}

function createClient(configService = buildMockConfigService()): TushareClient {
  // @ts-ignore 局部 mock，跳过 DI
  return new TushareClient(configService)
}

/** 构造一个成功的 Tushare JSON 响应体 */
function okResponse(fields: string[], items: unknown[][]): Response {
  return {
    json: async () => ({ code: 0, msg: '', data: { fields, items } }),
  } as unknown as Response
}

/** 构造一个错误的 Tushare JSON 响应体 */
function errResponse(code: number, msg: string): Response {
  return {
    json: async () => ({ code, msg, data: null }),
  } as unknown as Response
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('TushareClient', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    fetchSpy = jest.spyOn(global, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  // ── call() — 正常解析 ──────────────────────────────────────────────────────

  describe('call() — 正常解析', () => {
    it('应将 { fields, items } 正确解析为对象数组', async () => {
      fetchSpy.mockResolvedValueOnce(
        okResponse(['ts_code', 'name'], [['000001.SZ', '平安银行']]),
      )

      const client = createClient()
      const result = await client.call({ api_name: 'stock_basic' })

      expect(result).toEqual([{ ts_code: '000001.SZ', name: '平安银行' }])
    })

    it('items 为空时应返回空数组', async () => {
      fetchSpy.mockResolvedValueOnce(okResponse(['ts_code', 'name'], []))

      const client = createClient()
      const result = await client.call({ api_name: 'stock_basic' })

      expect(result).toEqual([])
    })

    it('data 为 null 时应返回空数组', async () => {
      fetchSpy.mockResolvedValueOnce({
        json: async () => ({ code: 0, msg: '', data: null }),
      } as unknown as Response)

      const client = createClient()
      const result = await client.call({ api_name: 'stock_basic' })

      expect(result).toEqual([])
    })

    it('应将多行数据全部解析为对象数组', async () => {
      fetchSpy.mockResolvedValueOnce(
        okResponse(
          ['ts_code', 'name', 'close'],
          [
            ['000001.SZ', '平安银行', 10.5],
            ['000002.SZ', '万科A', 20.3],
          ],
        ),
      )

      const client = createClient()
      const result = await client.call({ api_name: 'daily' })

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ ts_code: '000001.SZ', name: '平安银行', close: 10.5 })
      expect(result[1]).toEqual({ ts_code: '000002.SZ', name: '万科A', close: 20.3 })
    })
  })

  // ── call() — 错误处理 ─────────────────────────────────────────────────────

  describe('call() — 错误处理', () => {
    it('response code !== 0 时应抛出 TushareApiError', async () => {
      fetchSpy.mockResolvedValueOnce(errResponse(-2001, 'invalid token'))

      const client = createClient()

      await expect(client.call({ api_name: 'stock_basic' })).rejects.toBeInstanceOf(TushareApiError)
    })

    it('TushareApiError 应包含正确的 code 和 apiName', async () => {
      fetchSpy.mockResolvedValueOnce(errResponse(-2001, 'invalid token'))

      const client = createClient()

      try {
        await client.call({ api_name: 'stock_basic' })
        fail('应该抛出 TushareApiError')
      } catch (err) {
        expect(err).toBeInstanceOf(TushareApiError)
        const apiError = err as TushareApiError
        expect(apiError.code).toBe(-2001)
        expect(apiError.apiName).toBe('stock_basic')
      }
    })

    it('fetch 抛出网络异常时应向上传播', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const client = createClient()

      await expect(client.call({ api_name: 'stock_basic' })).rejects.toThrow('ECONNREFUSED')
    })
  })

  // ── call() — 频控重试 ─────────────────────────────────────────────────────

  describe('call() — 频控重试 (code=40203)', () => {
    it('命中频控时应重试，fetch 共被调用两次后成功', async () => {
      fetchSpy
        .mockResolvedValueOnce(errResponse(40203, '您每分钟最多访问该接口10次'))
        .mockResolvedValueOnce(okResponse(['ts_code'], [['000001.SZ']]))

      const client = createClient()
      const result = await client.call({ api_name: 'daily' })

      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(result).toEqual([{ ts_code: '000001.SZ' }])
    })

    it('maxRetries 耗尽后应抛出 TushareApiError，fetch 共调用 maxRetries+1 次', async () => {
      // maxRetries = 2，所以最多3次调用：1次原始 + 2次重试
      fetchSpy
        .mockResolvedValueOnce(errResponse(40203, '您每分钟最多访问该接口10次'))
        .mockResolvedValueOnce(errResponse(40203, '您每分钟最多访问该接口10次'))
        .mockResolvedValueOnce(errResponse(40203, '您每分钟最多访问该接口10次'))

      const client = createClient()

      await expect(client.call({ api_name: 'daily' })).rejects.toBeInstanceOf(TushareApiError)
      expect(fetchSpy).toHaveBeenCalledTimes(3) // 1 + maxRetries(2)
    })

    it('非频控错误码不应触发重试', async () => {
      fetchSpy.mockResolvedValueOnce(errResponse(-2001, 'invalid token'))

      const client = createClient()

      await expect(client.call({ api_name: 'daily' })).rejects.toBeInstanceOf(TushareApiError)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('msg 不含频控关键字时不应重试', async () => {
      fetchSpy.mockResolvedValueOnce(errResponse(40203, '其他错误'))

      const client = createClient()

      await expect(client.call({ api_name: 'daily' })).rejects.toBeInstanceOf(TushareApiError)
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  // ── parseRecords 私有方法 ─────────────────────────────────────────────────

  describe('parseRecords（私有方法）', () => {
    it('应将标准 TushareResponse 正确解析为对象数组', () => {
      const client = createClient()
      const json = {
        code: 0,
        msg: '',
        data: {
          fields: ['ts_code', 'name'],
          items: [['000001.SZ', '平安银行']],
        },
      }

      // @ts-ignore 访问私有方法
      const result = (client as any).parseRecords(json)

      expect(result).toEqual([{ ts_code: '000001.SZ', name: '平安银行' }])
    })

    it('data 为 null 时应返回空数组', () => {
      const client = createClient()
      // @ts-ignore
      const result = (client as any).parseRecords({ code: 0, msg: '', data: null })
      expect(result).toEqual([])
    })
  })
})
