import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { UserRole } from '@prisma/client'
import { ROLES_KEY } from 'src/common/decorators/roles.decorator'
import { ROLE_LEVEL } from 'src/constant/user.constant'
import { TokenPayload } from 'src/shared/token.service'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!requiredRoles || requiredRoles.length === 0) {
      return true
    }

    const { user } = context.switchToHttp().getRequest<{ user: TokenPayload }>()
    if (!user) {
      throw new ForbiddenException('权限不足')
    }

    const userLevel = ROLE_LEVEL[user.role] ?? 0
    const meetsRole = requiredRoles.some((role) => userLevel >= ROLE_LEVEL[role])
    if (!meetsRole) {
      throw new ForbiddenException('权限不足')
    }

    return true
  }
}
