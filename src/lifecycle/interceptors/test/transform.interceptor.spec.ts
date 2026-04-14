import { CallHandler, ExecutionContext } from '@nestjs/common'
import { of, firstValueFrom } from 'rxjs'
import { TransformInterceptor } from '../transform.interceptor'
import { ResponseModel } from 'src/common/models/response.model'

function makeCallHandler(returnValue: unknown): CallHandler {
  return { handle: () => of(returnValue) }
}

const mockContext = {} as ExecutionContext
const interceptor = new TransformInterceptor()

describe('TransformInterceptor', () => {
  it('wraps plain object in ResponseModel.success', async () => {
    const result = (await firstValueFrom(
      interceptor.intercept(mockContext, makeCallHandler({ items: [] })),
    )) as ResponseModel

    expect(result).toBeInstanceOf(ResponseModel)
    expect(result.code).toBe(0)
    expect(result.data).toEqual({ items: [] })
  })

  it('passes through an existing ResponseModel instance unchanged', async () => {
    const model = ResponseModel.success({ data: 'already wrapped' })
    const result = await firstValueFrom(interceptor.intercept(mockContext, makeCallHandler(model)))

    expect(result).toBe(model)
  })

  it('wraps null in ResponseModel.success with data = null', async () => {
    const result = (await firstValueFrom(interceptor.intercept(mockContext, makeCallHandler(null)))) as ResponseModel

    expect(result).toBeInstanceOf(ResponseModel)
    expect(result.code).toBe(0)
    expect(result.data).toBeNull()
  })

  it('wraps undefined in ResponseModel.success with data = undefined', async () => {
    const result = (await firstValueFrom(
      interceptor.intercept(mockContext, makeCallHandler(undefined)),
    )) as ResponseModel

    expect(result).toBeInstanceOf(ResponseModel)
    expect(result.code).toBe(0)
    expect(result.data).toBeUndefined()
  })

  it('wraps a string value in ResponseModel.success', async () => {
    const result = (await firstValueFrom(
      interceptor.intercept(mockContext, makeCallHandler('hello')),
    )) as ResponseModel

    expect(result).toBeInstanceOf(ResponseModel)
    expect(result.data).toBe('hello')
  })

  it('passes through a ResponseModel with error code unchanged', async () => {
    const errorModel = ResponseModel.error({ code: 9001, message: '校验失败', data: null })
    const result = await firstValueFrom(interceptor.intercept(mockContext, makeCallHandler(errorModel)))

    expect(result).toBe(errorModel)
    expect((result as ResponseModel).code).toBe(9001)
  })

  // ── [EDGE] 特殊数据类型 ───────────────────────────────────────────────────

  it('[EDGE] 空数组 → ResponseModel.success({ data: [] })', async () => {
    const result = (await firstValueFrom(interceptor.intercept(mockContext, makeCallHandler([])))) as ResponseModel

    expect(result).toBeInstanceOf(ResponseModel)
    expect(result.code).toBe(0)
    expect(result.data).toEqual([])
  })

  it('[EDGE] 数字 0（falsy）→ ResponseModel.success({ data: 0 })', async () => {
    const result = (await firstValueFrom(interceptor.intercept(mockContext, makeCallHandler(0)))) as ResponseModel

    expect(result).toBeInstanceOf(ResponseModel)
    expect(result.code).toBe(0)
    expect(result.data).toBe(0)
  })

  it('[EDGE] 空字符串（falsy）→ ResponseModel.success({ data: "" })', async () => {
    const result = (await firstValueFrom(interceptor.intercept(mockContext, makeCallHandler('')))) as ResponseModel

    expect(result).toBeInstanceOf(ResponseModel)
    expect(result.code).toBe(0)
    expect(result.data).toBe('')
  })
})
