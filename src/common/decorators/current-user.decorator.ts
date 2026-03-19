import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { TokenPayload } from 'src/shared/token.interface'

/** 从 JWT Payload 中获取当前登录用户信息 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): TokenPayload => {
  const request = ctx.switchToHttp().getRequest()
  return request.user as TokenPayload
})
