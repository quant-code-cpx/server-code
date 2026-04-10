import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { UserRole } from '@prisma/client'
import { RolesGuard } from '../roles.guard'
import { TokenPayload } from 'src/shared/token.interface'

function makeGuardAndCtx(user: Partial<TokenPayload> | null, requiredRoles: UserRole[] | undefined) {
  const mockReflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  } as unknown as Reflector

  const guard = new RolesGuard(mockReflector)

  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext

  return { guard, ctx }
}

describe('RolesGuard', () => {
  it('returns true when no @Roles() decorator is present', () => {
    const { guard, ctx } = makeGuardAndCtx({ role: UserRole.USER } as TokenPayload, undefined)
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('returns true when empty roles array is required', () => {
    const { guard, ctx } = makeGuardAndCtx({ role: UserRole.USER } as TokenPayload, [])
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('returns true when ADMIN required and user is ADMIN', () => {
    const { guard, ctx } = makeGuardAndCtx({ role: UserRole.ADMIN } as TokenPayload, [UserRole.ADMIN])
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('throws ForbiddenException when ADMIN required and user is USER', () => {
    const { guard, ctx } = makeGuardAndCtx({ role: UserRole.USER } as TokenPayload, [UserRole.ADMIN])
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException)
  })

  it('throws ForbiddenException when SUPER_ADMIN required and user is ADMIN (ROLE_LEVEL: ADMIN=2, SUPER_ADMIN=3)', () => {
    const { guard, ctx } = makeGuardAndCtx({ role: UserRole.ADMIN } as TokenPayload, [UserRole.SUPER_ADMIN])
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException)
  })

  it('returns true when SUPER_ADMIN required and user is SUPER_ADMIN', () => {
    const { guard, ctx } = makeGuardAndCtx({ role: UserRole.SUPER_ADMIN } as TokenPayload, [UserRole.SUPER_ADMIN])
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('throws ForbiddenException when roles required but no user in request', () => {
    const { guard, ctx } = makeGuardAndCtx(null, [UserRole.USER])
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException)
  })

  it('returns true when multiple required roles include the user role ([USER, ADMIN], user is USER)', () => {
    const { guard, ctx } = makeGuardAndCtx({ role: UserRole.USER } as TokenPayload, [UserRole.USER, UserRole.ADMIN])
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('returns true when user level is higher than minimum required role (USER required, user is SUPER_ADMIN)', () => {
    const { guard, ctx } = makeGuardAndCtx({ role: UserRole.SUPER_ADMIN } as TokenPayload, [UserRole.USER])
    expect(guard.canActivate(ctx)).toBe(true)
  })
})
