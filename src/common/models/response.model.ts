import { ApiProperty } from '@nestjs/swagger'
import { SUCCESS_CODE } from 'src/constant/response-code.constant'

/**
 * 统一响应数据模型
 */
export class ResponseModel<T = unknown> {
  @ApiProperty({ type: 'number', default: SUCCESS_CODE })
  code: number

  @ApiProperty()
  data?: T

  @ApiProperty({ type: 'string', default: '' })
  message: string

  constructor(code: number, data?: T, message = '') {
    this.code = code
    this.data = data
    this.message = message
  }

  static success<T>({ data, message }: { data?: T; message?: string } = {}) {
    return new ResponseModel<T>(SUCCESS_CODE, data, message)
  }

  static error({ code, message, data }: { code: number; message: string; data?: unknown }) {
    return new ResponseModel<unknown>(code, data ?? null, message)
  }
}
