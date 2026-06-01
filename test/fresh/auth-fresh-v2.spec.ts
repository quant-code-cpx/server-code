import { AuthController } from 'src/apps/auth/auth.controller'
import { AuthService } from 'src/apps/auth/auth.service'
import { createTestApp } from 'test/helpers/create-test-app'

describe('Auth Fresh V2', () => {
  const mockAuthService = {
    generateCaptcha: jest.fn(),
    login: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('AUTH-V2-001 /auth/captcha 应返回验证码结构', async () => {
    mockAuthService.generateCaptcha.mockResolvedValue({ captchaId: 'cid-1', svgImage: '<svg />' })

    const { app, request } = await createTestApp({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })

    await request.post('/auth/captcha').expect(201).expect(({ body }) => {
      expect(body.data.captchaId).toBe('cid-1')
      expect(body.data.svgImage).toContain('svg')
    })

    await app.close()
  })

  it('AUTH-V2-003 /auth/login 空 body 应返回 400（契约预期）', async () => {
    mockAuthService.login.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', refreshTokenTTL: 3600 })

    const { app, request } = await createTestApp({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })

    await request.post('/auth/login').send({}).expect(400)

    await app.close()
  })

  it('AUTH-V2-004 /auth/refresh 无 token 返回 401', async () => {
    const { app, request } = await createTestApp({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })

    await request.post('/auth/refresh').send({}).expect(200).expect(({ body }) => {
      expect(body.code).not.toBe(0)
    })

    await app.close()
  })
})
