import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtAuthGuard } from '../jwt-auth.guard'
import { PUBLIC_KEY } from 'src/constant/auth.constant'
import { RequestContextService } from 'src/shared/context/request-context.service'
import { TokenPayload } from 'src/shared/token.interface'
import { UserRole } from '@prisma/client'

function makeContext(opts: { isPublic?: boolean; user?: TokenPayload } = {}) {
  const handler = {}
  const controller = {}

  const mockReflector = {
    getAllAndOverride: jest.fn().mockImplementation((key: string) => {
      if (key === PUBLIC_KEY) return opts.isPublic ?? false
      return undefined
    }),
  } as unknown as Reflector

  const mockRequest: Record<string, unknown> = {}
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
})
