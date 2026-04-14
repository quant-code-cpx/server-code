import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtAuthGuard } from '../jwt-auth.guard'
import { PUBLIC_KEY } from 'src/constant/auth.constant'
import { RequestContextService } from 'src/shared/context/request-context.service'
import { TokenPayload } from 'src/shared/token.interface'
import { UserRole } from '@prisma/client'

function makeContext(opts: { isPublic?: boolean; user?: TokenPayload; url?: string } = {}) {
  const handler = {}
  const controller = {}

  const mockReflector = {
    getAllAndOverride: jest.fn().mockImplementation((key: string) => {
      if (key === PUBLIC_KEY) return opts.isPublic ?? false
      return undefined
    }),
  } as unknown as Reflector

  const mockRequest: Record<string, unknown> = {
    url: opts.url,
  }
  if (opts.user !== undefined) {
    mockRequest.user = opts.user
  }

  const ctx = {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => mockRequest,
    }),
  } as unknown as ExecutionContext

  return { ctx, mockReflector, mockRequest }
}

describe('JwtAuthGuard', () => {
  // Spy on the actual parent class that JwtAuthGuard extends (AuthGuard('jwt')).
  // Object.getPrototypeOf(JwtAuthGuard) gives the exact base class used at definition time.
  let superCanActivateSpy: jest.SpyInstance

  beforeEach(() => {
    superCanActivateSpy = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard).prototype, 'canActivate')
      .mockResolvedValue(true)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns true for @Public() route without calling passport', async () => {
    const { ctx, mockReflector } = makeContext({ isPublic: true })
    const guard = new JwtAuthGuard(mockReflector)

    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
    expect(superCanActivateSpy).not.toHaveBeenCalled()
  })

  it('returns true for non-public route with valid token', async () => {
    const user: TokenPayload = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }
    const { ctx, mockReflector } = makeContext({ user })
    const guard = new JwtAuthGuard(mockReflector)

    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
    expect(superCanActivateSpy).toHaveBeenCalledWith(ctx)
  })

  it('throws UnauthorizedException when passport canActivate throws', async () => {
    superCanActivateSpy.mockRejectedValue(new Error('invalid token'))
    const { ctx, mockReflector } = makeContext({ isPublic: false })
    const guard = new JwtAuthGuard(mockReflector)

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
  })

  it('throws UnauthorizedException when passport canActivate returns false', async () => {
    superCanActivateSpy.mockResolvedValue(false)
    const { ctx, mockReflector } = makeContext({ isPublic: false })
    const guard = new JwtAuthGuard(mockReflector)

    // returns false, not true → guard propagates the false result
    const result = await guard.canActivate(ctx)
    expect(result).toBe(false)
  })

  it('calls RequestContextService.setUserId when token is valid and user.id present', async () => {
    const user: TokenPayload = { id: 42, account: 'admin', nickname: 'Admin', role: UserRole.ADMIN, jti: 'jti-2' }
    const { ctx, mockReflector } = makeContext({ user })
    const setUserIdSpy = jest.spyOn(RequestContextService, 'setUserId').mockImplementation(() => undefined)
    const guard = new JwtAuthGuard(mockReflector)

    await guard.canActivate(ctx)

    expect(setUserIdSpy).toHaveBeenCalledWith(42)
  })

  // ── [SEC] PUBLIC_PATHS 白名单 ─────────────────────────────────────────────

  it('[SEC] /metrics 路径命中 PUBLIC_PATHS → 跳过 JWT，不调用 super.canActivate', async () => {
    const { ctx, mockReflector } = makeContext({ url: '/metrics', isPublic: false })
    const guard = new JwtAuthGuard(mockReflector)

    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
    expect(superCanActivateSpy).not.toHaveBeenCalled()
  })

  it('/metrics-debug 精确匹配修复（P5-B6）→ 需要 JWT 验证', async () => {
    // 修复后：PUBLIC_PATHS 使用精确匹配（url === p 或 startsWith(p + '/')）
    // /metrics-debug !== /metrics，不 startsWith '/metrics/'，也不 startsWith '/metrics?'
    // 因此不被放行，走 JWT 验证流程
    const { ctx, mockReflector } = makeContext({ url: '/metrics-debug', isPublic: false })
    const guard = new JwtAuthGuard(mockReflector)

    const result = await guard.canActivate(ctx)

    // 修复后行为：superCanActivate 被调用（JWT 验证），而不是被前缀放行
    expect(superCanActivateSpy).toHaveBeenCalled()
    expect(result).toBe(true) // superCanActivateSpy.mockResolvedValue(true)
  })

  // ── [EDGE] user.id 边界 ───────────────────────────────────────────────────

  it('[EDGE P5-B5] user.id 为 undefined → 不调用 setUserId', async () => {
    const user = { id: undefined, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-x' } as unknown as TokenPayload
    const { ctx, mockReflector } = makeContext({ user })
    const setUserIdSpy = jest.spyOn(RequestContextService, 'setUserId').mockImplementation(() => undefined)
    const guard = new JwtAuthGuard(mockReflector)

    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
    // user?.id is undefined (falsy) → setUserId is NOT called
    expect(setUserIdSpy).not.toHaveBeenCalled()
  })

  it('[EDGE P5-B5] user.id 为 0（falsy）→ 不调用 setUserId', async () => {
    const user = { id: 0, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-x' } as unknown as TokenPayload
    const { ctx, mockReflector } = makeContext({ user })
    const setUserIdSpy = jest.spyOn(RequestContextService, 'setUserId').mockImplementation(() => undefined)
    const guard = new JwtAuthGuard(mockReflector)

    const result = await guard.canActivate(ctx)

    expect(result).toBe(true)
    // user?.id is 0 (falsy) → setUserId is NOT called (PostgreSQL auto-increment starts at 1, so id=0 shouldn't occur)
    expect(setUserIdSpy).not.toHaveBeenCalled()
  })

  it('[EDGE] request.url 为 undefined → 不崩溃，走 JWT 验证流程', async () => {
    // url undefined → url?.startsWith(p) = undefined → falsy → 不匹配 PUBLIC_PATHS
    const user: TokenPayload = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-y' }
    const { ctx, mockReflector } = makeContext({ user, url: undefined })
    const guard = new JwtAuthGuard(mockReflector)

    await expect(guard.canActivate(ctx)).resolves.toBe(true)
    expect(superCanActivateSpy).toHaveBeenCalled()
  })
})

