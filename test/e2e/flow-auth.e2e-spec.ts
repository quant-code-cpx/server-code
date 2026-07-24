import type { INestApplication } from '@nestjs/common'
import type { PrismaService } from 'src/shared/prisma.service'

import { JwtService } from '@nestjs/jwt'
import { UserRole, UserStatus } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import request from 'supertest'
import type { RedisClientType } from 'redis'

import { AuthModule } from 'src/apps/auth/auth.module'
import { UserModule } from 'src/apps/user/user.module'
import { REFRESH_TOKEN_COOKIE, REFRESH_TOKEN_GRACE, REDIS_KEY } from 'src/constant/auth.constant'
import { createLegacyE2eApp } from './support/create-legacy-e2e-app'

const ACCOUNT = 'legacy_auth_user'
const PASSWORD = 'LegacyAuth!2026'

jest.setTimeout(60_000)

describe('旧业务 E2E Flow 1 — 认证生命周期', () => {
  let app: INestApplication
  let prisma: PrismaService
  let redis: RedisClientType

  beforeAll(async () => {
    const fixture = await createLegacyE2eApp({ imports: [AuthModule, UserModule] })
    app = fixture.app
    prisma = fixture.prisma
    redis = fixture.redis
    await redis.flushDb()
    await prisma.auditLog.deleteMany()
    await prisma.user.deleteMany()
    await prisma.user.create({
      data: {
        account: ACCOUNT,
        password: await bcrypt.hash(PASSWORD, 6),
        nickname: 'Legacy Auth E2E',
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
      },
    })
  })

  afterAll(async () => {
    await prisma.auditLog.deleteMany()
    await prisma.user.deleteMany()
    await redis.flushDb()
    await app.close()
  })

  it('LEG-AUTH-BIZ-001：验证码→登录→资料→刷新轮换→登出全链路', async () => {
    const client = request.agent(app.getHttpServer())
    const captcha = await issueCaptcha(app, redis)
    const login = await client
      .post('/api/auth/login')
      .send({ account: ACCOUNT, password: PASSWORD, ...captcha })
      .expect(201)
    expect(login.body).toMatchObject({ code: 0, data: { accessToken: expect.any(String) } })
    const firstAccessToken = login.body.data.accessToken as string
    const firstRefreshCookie = requireCookie(login, REFRESH_TOKEN_COOKIE)

    const profile = await request(app.getHttpServer())
      .post('/api/user/profile/detail')
      .set('Authorization', `Bearer ${firstAccessToken}`)
      .send({})
      .expect(201)
    expect(profile.body.data).toMatchObject({ account: ACCOUNT, role: UserRole.USER, status: UserStatus.ACTIVE })
    expect(profile.body.data.password).toBeUndefined()

    const refresh = await client.post('/api/auth/refresh').send({}).expect(201)
    expect(refresh.body).toMatchObject({ code: 0, data: { accessToken: expect.any(String) } })
    const rotatedAccessToken = refresh.body.data.accessToken as string
    expect(rotatedAccessToken).not.toBe(firstAccessToken)
    expect(requireCookie(refresh, REFRESH_TOKEN_COOKIE)).not.toBe(firstRefreshCookie)

    const graceReplay = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', firstRefreshCookie)
      .send({})
      .expect(201)
    expect(graceReplay.body).toMatchObject({ code: 0, data: { accessToken: expect.any(String) } })
    expect(readSetCookies(graceReplay)).toHaveLength(0)

    await delay((REFRESH_TOKEN_GRACE + 1) * 1000)
    const expiredReplay = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', firstRefreshCookie)
      .send({})
      .expect(200)
    expect(expiredReplay.body.code).toBe(1006)

    const logout = await client
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .send({})
      .expect(201)
    expect(logout.body.code).toBe(0)

    await request(app.getHttpServer())
      .post('/api/user/profile/detail')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .send({})
      .expect(401)

    const revokedRefresh = await client.post('/api/auth/refresh').send({}).expect(200)
    expect(revokedRefresh.body.code).toBe(1006)
  })

  it('LEG-AUTH-SEC-001：同一验证码并发登录最多成功一次', async () => {
    const captcha = await issueCaptcha(app, redis)
    const payload = { account: ACCOUNT, password: PASSWORD, ...captcha }
    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/api/auth/login').send(payload),
      request(app.getHttpServer()).post('/api/auth/login').send(payload),
    ])
    const codes = [first.body.code, second.body.code].sort((a, b) => a - b)
    expect(codes).toEqual([0, 1004])
    expect(await redis.get(REDIS_KEY.CAPTCHA(captcha.captchaId))).toBeNull()
  })

  it('LEG-AUTH-SEC-002：已过期 Access Token 登出不报错，且不能访问受保护接口', async () => {
    const jwt = app.get(JwtService)
    const expiredToken = await jwt.signAsync(
      { id: 999, account: 'expired', nickname: null, role: UserRole.USER, jti: 'expired-jti' },
      { secret: process.env.ACCESS_TOKEN_SECRET, expiresIn: -1 },
    )

    const logout = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({})
      .expect(201)
    expect(logout.body.code).toBe(0)

    await request(app.getHttpServer())
      .post('/api/user/profile/detail')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({})
      .expect(401)
  })
})

async function issueCaptcha(app: INestApplication, redis: RedisClientType) {
  const response = await request(app.getHttpServer()).post('/api/auth/captcha').send({}).expect(201)
  expect(response.body).toMatchObject({
    code: 0,
    data: { captchaId: expect.any(String), svgImage: expect.stringContaining('<svg') },
  })
  const captchaId = response.body.data.captchaId as string
  const captchaCode = await redis.get(REDIS_KEY.CAPTCHA(captchaId))
  if (!captchaCode) throw new Error('验证码未写入 Redis')
  return { captchaId, captchaCode }
}

function readSetCookies(response: request.Response): string[] {
  const header = response.headers['set-cookie']
  if (Array.isArray(header)) return header
  return typeof header === 'string' ? [header] : []
}

function requireCookie(response: request.Response, name: string): string {
  const cookie = readSetCookies(response).find((value) => value.startsWith(`${name}=`))
  if (!cookie) throw new Error(`响应缺少 Cookie: ${name}`)
  return cookie.split(';', 1)[0]
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
