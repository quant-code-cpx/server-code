import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import * as request from 'supertest'
import { AuthController } from '../auth.controller'
import { AuthService } from '../auth.service'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'

const mockAuthService = {
  generateCaptcha: jest.fn(async () => ({ captchaId: 'cap-1', svg: '<svg/>' })),
  login: jest.fn(async () => ({ accessToken: 'access-1', refreshToken: 'refresh-1', refreshTokenTTL: 3600 })),
  refreshToken: jest.fn(async () => ({ accessToken: 'access-2', refreshToken: 'refresh-2', refreshTokenTTL: 3600 })),
  logout: jest.fn(async () => undefined),
}

describe('AuthController (integration)', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        // All auth routes are @Public(), so the guard just needs to exist
        { provide: JwtAuthGuard, useValue: { canActivate: () => true } },
      ],
    }).compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

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

  // NestJS defaults @Post handlers to HTTP 201 Created; the TransformInterceptor
  // wraps the response body but does not change the HTTP status code.
  it('POST /auth/captcha → 201, data.captchaId present', async () => {
    const res = await request(app.getHttpServer()).post('/auth/captcha').expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.captchaId).toBe('cap-1')
  })

  it('POST /auth/login with valid body → 201, data.accessToken present', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ account: 'admin', password: '123456', captchaId: 'cap-1', captchaCode: 'ABCD' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.accessToken).toBe('access-1')
    expect(mockAuthService.login).toHaveBeenCalledTimes(1)
  })

  // LoginDto uses @Allow() decorators (lenient — no @IsNotEmpty()), so fields are
  // not enforced as required by ValidationPipe. An empty body still reaches the
  // service and the mock returns successfully.
  it('POST /auth/login with empty body → 201 (LoginDto uses @Allow(), no required validators)', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({}).expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.accessToken).toBe('access-1')
  })

  it('POST /auth/refresh with refreshToken in body → 201, data.accessToken present', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'old-refresh-token' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.accessToken).toBe('access-2')
    expect(mockAuthService.refreshToken).toHaveBeenCalledWith('old-refresh-token')
  })

  // When no refreshToken is provided (no cookie, no body), the controller throws
  // BusinessException(INVALID_REFRESH_TOKEN) which uses HttpStatus.OK so the HTTP
  // status stays 200 but the response code is non-zero.
  it('POST /auth/refresh with no token → 200 with non-zero error code', async () => {
    const res = await request(app.getHttpServer()).post('/auth/refresh').send({}).expect(200)
    expect(res.body.code).not.toBe(0)
    expect(mockAuthService.refreshToken).not.toHaveBeenCalled()
  })

  it('POST /auth/logout → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', 'Bearer some-token')
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(mockAuthService.logout).toHaveBeenCalledTimes(1)
  })
})
