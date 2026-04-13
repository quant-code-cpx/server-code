import { UnauthorizedException } from '@nestjs/common'
import { createTestApp } from 'test/helpers/create-test-app'
import { AuthController } from '../auth.controller'
import { AuthService } from '../auth.service'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import type { INestApplication } from '@nestjs/common'

const mockAuthService = {
  generateCaptcha: jest.fn(),
  login: jest.fn(),
  refreshToken: jest.fn(),
  logout: jest.fn(),
}

describe('AuthController (integration)', () => {
  let app: INestApplication
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let req: any

  beforeAll(async () => {
    const result = await createTestApp({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
      // All auth routes are @Public(); user value is irrelevant
    })
    app = result.app
    req = result.request
  })

  afterAll(() => app.close())

  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthService.generateCaptcha.mockResolvedValue({ captchaId: 'cap-1', svg: '<svg/>' })
    mockAuthService.login.mockResolvedValue({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      refreshTokenTTL: 3600,
    })
    mockAuthService.refreshToken.mockResolvedValue({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      refreshTokenTTL: 3600,
    })
    mockAuthService.logout.mockResolvedValue(undefined)
  })

  // ── [BIZ] 正常业务路径 ────────────────────────────────────────────────────

  // NestJS defaults @Post handlers to HTTP 201 Created; TransformInterceptor
  // wraps the response body but does not change the HTTP status code.
  it('POST /auth/captcha → 201, data.captchaId present', async () => {
    const res = await req.post('/auth/captcha').expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.captchaId).toBe('cap-1')
  })

  it('POST /auth/login with valid body → 201, data.accessToken present', async () => {
    const res = await req
      .post('/auth/login')
      .send({ account: 'admin', password: '123456', captchaId: 'cap-1', captchaCode: 'ABCD' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.accessToken).toBe('access-1')
    expect(mockAuthService.login).toHaveBeenCalledTimes(1)
  })

  it('POST /auth/refresh with refreshToken in body → 201, data.accessToken present', async () => {
    const res = await req.post('/auth/refresh').send({ refreshToken: 'old-refresh-token' }).expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.accessToken).toBe('access-2')
    expect(mockAuthService.refreshToken).toHaveBeenCalledWith('old-refresh-token')
  })

  // When no refreshToken is provided the controller throws BusinessException(INVALID_REFRESH_TOKEN)
  // which uses HttpStatus.OK, so HTTP status stays 200 but code is non-zero.
  it('POST /auth/refresh with no token → 200 with non-zero error code', async () => {
    const res = await req.post('/auth/refresh').send({}).expect(200)
    expect(res.body.code).not.toBe(0)
    expect(mockAuthService.refreshToken).not.toHaveBeenCalled()
  })

  it('POST /auth/logout → 201', async () => {
    const res = await req.post('/auth/logout').set('Authorization', 'Bearer some-token').expect(201)
    expect(res.body.code).toBe(0)
    expect(mockAuthService.logout).toHaveBeenCalledTimes(1)
  })

  // ── [VAL] DTO 校验 ──────────────────────────────────────────────────────────

  // [BUG P4-B1] LoginDto 所有字段仅用 @Allow() 装饰，无任何必填校验。
  // ValidationPipe 不会拒绝空 body，导致空凭据请求直达 service。
  it('[BUG P4-B1] POST /auth/login empty body → 201（LoginDto 用 @Allow() 无 required 校验）', async () => {
    const res = await req.post('/auth/login').send({}).expect(201)
    expect(res.body.code).toBe(0)
    // 文档化缺陷：account/password 缺失也能调到 service
    expect(mockAuthService.login).toHaveBeenCalledTimes(1)
  })

  // ── [ERR] 异常透传 ─────────────────────────────────────────────────────────

  it('[ERR] POST /auth/login → service 抛 UnauthorizedException → HTTP 401', async () => {
    mockAuthService.login.mockRejectedValueOnce(new UnauthorizedException('用户名或密码有误'))
    const res = await req
      .post('/auth/login')
      .send({ account: 'admin', password: 'wrong', captchaId: 'cap-1', captchaCode: 'ABCD' })
      .expect(401)
    expect(res.body.code).not.toBe(0)
  })

  it('[ERR] POST /auth/login → service 抛 BusinessException(ACCOUNT_LOCKED) → HTTP 200 + 非零 code 1005', async () => {
    mockAuthService.login.mockRejectedValueOnce(new BusinessException(ErrorEnum.ACCOUNT_LOCKED))
    const res = await req
      .post('/auth/login')
      .send({ account: 'locked-user', password: 'pass123', captchaId: 'cap-1', captchaCode: 'ABCD' })
      .expect(200)
    expect(res.body.code).toBe(1005)
  })
})
