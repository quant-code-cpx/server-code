import { ArgumentsHost, BadRequestException, HttpException } from '@nestjs/common'
import { GlobalExceptionsFilter } from '../global.exception'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { ResponseModel } from 'src/common/models/response.model'
import { TushareApiError } from 'src/tushare/api/tushare-client.service'
import { LoggerService } from 'src/shared/logger/logger.service'

function makeHost(url = '/test') {
  const mockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  }
  const mockRequest = { url }
  const host = {
    switchToHttp: () => ({
      getRequest: () => mockRequest,
      getResponse: () => mockResponse,
    }),
  } as unknown as ArgumentsHost
  return { host, mockResponse }
}

function createFilter(isDev = false): GlobalExceptionsFilter {
  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    devLog: jest.fn(),
  } as unknown as LoggerService
  return new GlobalExceptionsFilter(isDev, mockLogger)
}

describe('GlobalExceptionsFilter', () => {
  it('handles HttpException with status 400', () => {
    const filter = createFilter()
    const { host, mockResponse } = makeHost()

    filter.catch(new HttpException('Bad Request', 400), host)

    expect(mockResponse.status).toHaveBeenCalledWith(400)
    const json = mockResponse.json.mock.calls[0][0] as ResponseModel
    expect(json.code).toBe(400)
    expect(json.message).toBe('Bad Request')
  })

  it('handles BusinessException — returns HTTP 200 with domain error code', () => {
    const filter = createFilter()
    const { host, mockResponse } = makeHost()

    filter.catch(new BusinessException(ErrorEnum.VALIDATION_ERROR), host)

    expect(mockResponse.status).toHaveBeenCalledWith(200)
    const json = mockResponse.json.mock.calls[0][0] as ResponseModel
    expect(json.code).toBe(9001)
    expect(json.message).toBe('请求参数校验失败')
  })

  it('handles BadRequestException with array of messages — sets details and validation error code', () => {
    const filter = createFilter()
    const { host, mockResponse } = makeHost()
    const errors = ['field1 is required', 'field2 must be a string']

    filter.catch(new BadRequestException({ message: errors }), host)

    expect(mockResponse.status).toHaveBeenCalledWith(400)
    const json = mockResponse.json.mock.calls[0][0] as ResponseModel
    expect(json.code).toBe(9001)
    expect(json.message).toBe('请求参数校验失败')
    expect((json.data as Record<string, unknown>).details).toEqual(errors)
  })

  it('returns 500 and hides error message in non-dev mode for unknown errors', () => {
    const filter = createFilter(false)
    const { host, mockResponse } = makeHost()

    filter.catch(new Error('internal secret details'), host)

    expect(mockResponse.status).toHaveBeenCalledWith(500)
    const json = mockResponse.json.mock.calls[0][0] as ResponseModel
    expect(json.code).toBe(500)
    expect(json.message).not.toContain('internal secret details')
    expect(json.message).toBe('服务繁忙，请稍后再试')
  })

  it('preserves error message in dev mode for unknown errors', () => {
    const filter = createFilter(true)
    const { host, mockResponse } = makeHost()

    filter.catch(new Error('dev error detail'), host)

    expect(mockResponse.status).toHaveBeenCalledWith(500)
    const json = mockResponse.json.mock.calls[0][0] as ResponseModel
    expect(json.message).toContain('dev error detail')
  })

  it('handles TushareApiError — sets domain code 3002 and exposes tushareCode and apiName in data', () => {
    const filter = createFilter(false)
    const { host, mockResponse } = makeHost()

    filter.catch(new TushareApiError('daily', -2001, 'tushare api failed'), host)

    expect(mockResponse.status).toHaveBeenCalledWith(500)
    const json = mockResponse.json.mock.calls[0][0] as ResponseModel
    expect(json.code).toBe(3002)
    expect(json.message).toBe('Tushare 接口调用失败')
    const data = json.data as Record<string, unknown>
    expect(data.tushareCode).toBe(-2001)
    expect(data.apiName).toBe('daily')
  })

  // ── [SEC] 非 Error 异常 ───────────────────────────────────────────────────

  it('[BUG P5-B1] throw 字符串 → 不崩溃，logger.error 中 message 为 undefined，非 dev 返回通用 500 消息', () => {
    // exception = 'raw error text'（不是 Error 实例）
    // 修复前：(exception as Error).message — string 有 .message 但值为 undefined 不崩溃
    // 修复后：exception instanceof Error → false → message=undefined（与修复前一致）
    const mockLogger = {
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as LoggerService
    const filter = new GlobalExceptionsFilter(false, mockLogger)
    const { host, mockResponse } = makeHost()

    filter.catch('raw error text', host)

    expect(mockResponse.status).toHaveBeenCalledWith(500)
    const json = mockResponse.json.mock.calls[0][0] as ResponseModel
    // 非 dev 模式下，message 被隐藏为通用消息（字符串异常不泄露到响应体）
    expect(json.message).toBe('服务繁忙，请稍后再试')
    // logger.error 被调用，message=undefined，stack=undefined（string 不是 Error 实例）
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: undefined }),
      undefined,
      'GlobalExceptionsFilter',
    )
  })

  it('[BUG P5-B1] throw null → 修复后不崩溃，返回 500 通用消息', () => {
    // 修复前行为：(null as Error).message 抛出 TypeError: Cannot read properties of null
    // 修复后行为：null instanceof Error = false → message=undefined → 不崩溃
    const filter = createFilter(false)
    const { host, mockResponse } = makeHost()

    expect(() => filter.catch(null, host)).not.toThrow()
    expect(mockResponse.status).toHaveBeenCalledWith(500)
    const json = mockResponse.json.mock.calls[0][0] as ResponseModel
    expect(json.message).toBe('服务繁忙，请稍后再试')
  })

  it('[BUG P5-B1] throw undefined → 修复后不崩溃，返回 500 通用消息', () => {
    // 修复前行为：(undefined as Error).message 抛出 TypeError
    // 修复后行为：undefined instanceof Error = false → message=undefined → 不崩溃
    const filter = createFilter(false)
    const { host, mockResponse } = makeHost()

    expect(() => filter.catch(undefined, host)).not.toThrow()
    expect(mockResponse.status).toHaveBeenCalledWith(500)
    const json = mockResponse.json.mock.calls[0][0] as ResponseModel
    expect(json.message).toBe('服务繁忙，请稍后再试')
  })

  it('[ERR] Error with cause（嵌套异常）→ 响应仅返回顶层 message', () => {
    // 使用 Object.assign 模拟带 cause 的嵌套异常（避免 TS lib 版本限制）
    const cause = new Error('root cause')
    const error = Object.assign(new Error('surface error'), { cause })
    const filter = createFilter(true) // dev mode: show message
    const { host, mockResponse } = makeHost()

    filter.catch(error, host)

    expect(mockResponse.status).toHaveBeenCalledWith(500)
    const json = mockResponse.json.mock.calls[0][0] as ResponseModel
    // 响应只暴露顶层 message，不含 cause 细节
    expect(json.message).toBe('surface error')
    expect(json.message).not.toContain('root cause')
  })

  it('[EDGE] BadRequestException 单条 string message → status 400，不触发 VALIDATION_ERROR(9001) 分支', () => {
    // 单条 string 不是 array → validationMessages = null → 不进入 VALIDATION_ERROR 分支
    const filter = createFilter()
    const { host, mockResponse } = makeHost()

    filter.catch(new BadRequestException('invalid input format'), host)

    expect(mockResponse.status).toHaveBeenCalledWith(400)
    const json = mockResponse.json.mock.calls[0][0] as ResponseModel
    // apiErrorCode falls through to `status` (400), not VALIDATION_ERROR code (9001)
    expect(json.code).toBe(400)
    expect(json.message).toBe('invalid input format')
  })

  it('[BIZ] BusinessException 附带 data → HTTP 200 + domain code + data 透传', () => {
    const filter = createFilter()
    const { host, mockResponse } = makeHost()
    const extraData = { detail: 'something went wrong', field: 'username' }

    // BusinessException('code:message', data) → HTTP 200 (OK status from NestJS), domain code
    filter.catch(new BusinessException(ErrorEnum.VALIDATION_ERROR, extraData), host)

    expect(mockResponse.status).toHaveBeenCalledWith(200)
    const json = mockResponse.json.mock.calls[0][0] as ResponseModel
    expect(json.code).toBe(9001)
    // data should be transparently passed through
    expect(json.data).toEqual(extraData)
  })

  it('[ERR] 巨大异常对象（防止日志处理崩溃）→ 不崩溃，正常返回 500', () => {
    // 构造带巨大元数据的 Error（模拟 OOM 风险场景）
    const largeError = new Error('large error')
    Object.assign(largeError, { largePayload: 'x'.repeat(10_000) })
    const filter = createFilter(false)
    const { host, mockResponse } = makeHost()

    expect(() => filter.catch(largeError, host)).not.toThrow()
    expect(mockResponse.status).toHaveBeenCalledWith(500)
  })
})

