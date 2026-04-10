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
})
