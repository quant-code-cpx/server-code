import { UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { UserRole, UserStatus } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { TokenService } from 'src/shared/token.service'
import { TokenPayload } from 'src/shared/token.interface'
import { JwtStrategy } from '../strategies/jwt.strategy'

function payload(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return {
    id: 7,
    account: 'trader',
    nickname: 'Trader',
    role: UserRole.USER,
    authVersion: 3,
    jti: 'access-jti',
    ...overrides,
  }
}

function createStrategy() {
  const config = {
    get: jest.fn(() => ({ accessTokenOptions: { secret: 'test-secret-32-chars-long-enough' } })),
  }
  const tokenService = {
    isAccessTokenBlacklisted: jest.fn().mockResolvedValue(false),
  }
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ status: UserStatus.ACTIVE, authVersion: 3 }),
    },
  }
  const strategy = new JwtStrategy(
    config as unknown as ConfigService,
    tokenService as unknown as TokenService,
    prisma as unknown as PrismaService,
  )
  return { strategy, tokenService, prisma }
}

describe('JwtStrategy token version', () => {
  it('仅接受活动用户且认证版本匹配的 Access Token', async () => {
    const { strategy, tokenService, prisma } = createStrategy()
    const token = payload()

    await expect(strategy.validate(token)).resolves.toEqual(token)
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { status: true, authVersion: true },
    })
    expect(tokenService.isAccessTokenBlacklisted).toHaveBeenCalledWith('access-jti')
  })

  it('密码、状态或角色变更后的旧 Access Token 被拒绝', async () => {
    const { strategy, tokenService, prisma } = createStrategy()
    prisma.user.findUnique.mockResolvedValue({ status: UserStatus.ACTIVE, authVersion: 4 })

    await expect(strategy.validate(payload())).rejects.toBeInstanceOf(UnauthorizedException)
    expect(tokenService.isAccessTokenBlacklisted).not.toHaveBeenCalled()
  })

  it('缺少认证版本的历史 Access Token 被拒绝', async () => {
    const { strategy, prisma } = createStrategy()

    await expect(strategy.validate(payload({ authVersion: undefined }))).rejects.toBeInstanceOf(UnauthorizedException)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })
})
