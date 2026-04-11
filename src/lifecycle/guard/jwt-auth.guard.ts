import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthGuard } from '@nestjs/passport'
import { PUBLIC_KEY } from 'src/constant/auth.constant'
import { RequestContextService } from 'src/shared/context/request-context.service'
import { TokenPayload } from 'src/shared/token.interface'

/** Prometheus 等基础设施端点，无需 JWT 鉴权 */
const PUBLIC_PATHS = ['/metrics']

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super()
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])

    if (isPublic) return true

    // 基础设施路径白名单放行（Prometheus scraper 不携带 JWT）
    const request = context.switchToHttp().getRequest()
    if (PUBLIC_PATHS.some((p) => request.url?.startsWith(p))) return true

    try {
      const result = (await super.canActivate(context)) as boolean
      if (result) {
        const { user } = context.switchToHttp().getRequest<{ user: TokenPayload }>()
        if (user?.id) {
          RequestContextService.setUserId(user.id)
        }
      }
      return result
    } catch {
      throw new UnauthorizedException('用户未登录或 Token 已失效')
    }
  }
}
