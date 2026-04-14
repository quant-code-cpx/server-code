import { CallHandler } from '@nestjs/common'
import { of, throwError } from 'rxjs'

/** 返回固定值的 CallHandler mock */
export function makeCallHandler(returnValue: unknown): CallHandler {
  return { handle: () => of(returnValue) }
}

/** 抛出指定错误的 CallHandler mock */
export function makeCallHandlerWithError(error: unknown): CallHandler {
  return { handle: () => throwError(() => error) }
}
