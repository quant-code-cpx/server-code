/**
 * Auth 真实 Redis 集成测试（无 mock）
 */
import { Test, TestingModule } from '@nestjs/testing'
import { AuthService } from '../auth.service'
import { PrismaService } from 'src/shared/prisma.service'
import { TokenService } from 'src/shared/token.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import { REDIS_CLIENT } from 'src/shared/redis.provider'
import { createClient } from 'redis'
import { BusinessException } from 'src/common/exceptions/business.exception'
import net from 'node:net'
import * as bcrypt from 'bcrypt'

async function canConnectRedis(host: string, port: number, timeoutMs = 1200): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)

    const done = (ok: boolean) => {
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

const shouldRunRealRedis = process.env.RUN_REDIS_INTEGRATION === 'true'

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

describe('Auth — 真实 Redis 集成测试', () => {
  let service: AuthService
  let redis: any
  let redisAvailable = true
  let prisma: {
    user: {
      findUnique: jest.Mock
      update: jest.Mock
    }
  }

  beforeAll(async () => {
    if (!shouldRunRealRedis) {
      redisAvailable = false
      redis = {
        keys: async () => [],
        del: async () => 0,
        quit: async () => undefined,
      }
      return
    }

    const host = process.env.REDIS_HOST ?? '127.0.0.1'
    const port = Number(process.env.REDIS_PORT ?? '6379')
    const password = process.env.REDIS_PASSWORD ?? 'password'
    redisAvailable = await canConnectRedis(host, port)

    prisma = {
      user: {
        findUnique: jest.fn(async ({ where: { account } }: { where: { account?: string } }) => {
          if (account === 'qa_tester') {
            return {
              id: 1,
              account: 'qa_tester',
              nickname: 'QA',
              role: 'USER',
              status: 'ACTIVE',
              password: await bcrypt.hash('correct-password', 4),
            }
          }
          if (account === 'no_user') {
            return null
          }
          return null
        }),
        update: jest.fn(),
      },
    }

    if (redisAvailable) {
      redis = createClient({
        socket: { host, port, connectTimeout: 2000, reconnectStrategy: false },
        password,
      })
      redis.on('error', () => {})
      try {
        await withTimeout(redis.connect(), 3000, 'redis.connect')
        const keys = (await withTimeout(redis.keys('auth:*'), 2000, 'redis.keys')) as string[]
        if (keys.length > 0) await withTimeout(redis.del(keys), 2000, 'redis.del')
      } catch {
        redisAvailable = false
      }
    } else {
      redisAvailable = false
      redis = {
        keys: async () => [],
        del: async () => 0,
        quit: async () => undefined,
      }
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: { generateTokens: jest.fn(), verifyRefreshToken: jest.fn(), isRefreshTokenValid: jest.fn(), generateAccessToken: jest.fn(), revokeRefreshToken: jest.fn(), blacklistAccessToken: jest.fn(), deleteRefreshToken: jest.fn() } },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: LoggerService, useValue: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, devLog: () => {} } },
      ],
    }).compile()
    service = module.get<AuthService>(AuthService)
  }, 15000)

  afterAll(async () => {
    if (redisAvailable && redis?.isOpen) {
      const keys = (await withTimeout(redis.keys('auth:*'), 2000, 'redis.keys')) as string[]
      if (keys.length > 0) await withTimeout(redis.del(keys), 2000, 'redis.del')
      await withTimeout(redis.quit(), 2000, 'redis.quit')
    }
  })

  function skipWhenRedisUnavailable() {
    if (!shouldRunRealRedis || !redisAvailable) return true
    return false
  }

  it('生成验证码 → Redis 存储 + TTL=60s', async () => {
    if (skipWhenRedisUnavailable()) return
    const r = await service.generateCaptcha()
    expect(r.captchaId).toBeTruthy()
    expect(r.svgImage).toContain('<svg')
    const stored = await redis.get(`auth:captcha:${r.captchaId}`)
    expect(stored).toBe(stored.toLowerCase())
    const ttl = await redis.ttl(`auth:captcha:${r.captchaId}`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60)
  })

  it('验证码一次性 → getDel 后不存在', async () => {
    if (skipWhenRedisUnavailable()) return
    const c = await service.generateCaptcha()
    const key = `auth:captcha:${c.captchaId}`
    expect(await redis.getDel(key)).toBeTruthy()
    expect(await redis.get(key)).toBeNull()
  })

  it('登录失败 → 写入失败计数', async () => {
    if (skipWhenRedisUnavailable()) return
    const c = await service.generateCaptcha()
    const code = await redis.get(`auth:captcha:${c.captchaId}`)
    try { await service.login({ account: 'qa_tester', password: 'wrong', captchaId: c.captchaId, captchaCode: code! }) } catch (e) { expect(e).toBeInstanceOf(BusinessException) }
    expect(await redis.get('auth:login:fail:qa_tester')).toBe('1')
  })

  it('连续 5 次失败 → 账号锁定 + 计数清除', async () => {
    if (skipWhenRedisUnavailable()) return
    await redis.del('auth:login:fail:qa_tester')
    await redis.del('auth:login:lock:qa_tester')
    for (let i = 0; i < 4; i++) {
      const c = await service.generateCaptcha()
      const code = await redis.get(`auth:captcha:${c.captchaId}`)
      try { await service.login({ account: 'qa_tester', password: 'wrong', captchaId: c.captchaId, captchaCode: code! }) } catch (e) {}
    }
    expect(Number(await redis.get('auth:login:fail:qa_tester'))).toBe(4)
    expect(await redis.exists('auth:login:lock:qa_tester')).toBe(0)

    const c = await service.generateCaptcha()
    const code = await redis.get(`auth:captcha:${c.captchaId}`)
    try { await service.login({ account: 'qa_tester', password: 'wrong', captchaId: c.captchaId, captchaCode: code! }) } catch (e) {}
    expect(await redis.exists('auth:login:lock:qa_tester')).toBe(1)
    expect(await redis.get('auth:login:fail:qa_tester')).toBeNull()
  })

  it('不存在账号不写 Redis', async () => {
    if (skipWhenRedisUnavailable()) return
    const c = await service.generateCaptcha()
    const code = await redis.get(`auth:captcha:${c.captchaId}`)
    try { await service.login({ account: 'no_user', password: 'any', captchaId: c.captchaId, captchaCode: code! }) } catch (e) {}
    expect(await redis.get('auth:login:fail:no_user')).toBeNull()
  })
})

jest.setTimeout(30000)
