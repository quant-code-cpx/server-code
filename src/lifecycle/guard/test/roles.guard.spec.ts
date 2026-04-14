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

  // ── [SEC] 角色伪造防护 ─────────────────────────────────────────────────────

  it('[SEC] user.role 为非法值 "HACKER" → ROLE_LEVEL[HACKER] = undefined → ?? 0 → 权限不足', () => {
    // ROLE_LEVEL 是固定 Record，'HACKER' 不在枚举中 → undefined
    // undefined ?? 0 = 0; ROLE_LEVEL[USER] = 1; 0 >= 1 → false → ForbiddenException
    const { guard, ctx } = makeGuardAndCtx({ role: 'HACKER' as unknown as UserRole }, [UserRole.USER])
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException)
  })

  it('[EDGE] user.role 为 undefined → ROLE_LEVEL[undefined] = undefined → ?? 0 → 权限不足', () => {
    // undefined role: ROLE_LEVEL[undefined] = undefined → ?? 0 = 0 → 0 >= 1 → false → ForbiddenException
    const { guard, ctx } = makeGuardAndCtx({ role: undefined as unknown as UserRole }, [UserRole.USER])
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException)
  })

  it('[BIZ] requiredRoles 使用 some 语义 — 只需满足其中一个最低角色即可', () => {
    // requiredRoles = [ADMIN, SUPER_ADMIN]；some 语义：userLevel >= min(ADMIN.level, SUPER_ADMIN.level)
    // 实际逻辑：some(role => userLevel >= ROLE_LEVEL[role])
    // USER (level=1) vs ADMIN (level=2): 1 >= 2 → false; USER (level=1) vs SUPER_ADMIN (level=3): 1 >= 3 → false
    // → ForbiddenException（both fail）
    const { guard: guardFail, ctx: ctxFail } = makeGuardAndCtx(
      { role: UserRole.USER } as TokenPayload,
      [UserRole.ADMIN, UserRole.SUPER_ADMIN],
    )
    expect(() => guardFail.canActivate(ctxFail)).toThrow(ForbiddenException)

    // ADMIN (level=2) vs ADMIN (level=2): 2 >= 2 → true (some → true)
    const { guard: guardPass, ctx: ctxPass } = makeGuardAndCtx(
      { role: UserRole.ADMIN } as TokenPayload,
      [UserRole.ADMIN, UserRole.SUPER_ADMIN],
    )
    expect(guardPass.canActivate(ctxPass)).toBe(true)
  })
})
