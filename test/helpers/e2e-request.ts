/**
 * E2eClient — E2E 测试请求辅助类
 */
import { INestApplication } from '@nestjs/common'
import request from 'supertest'

export class E2eClient {
  private accessToken: string | null = null

  constructor(private readonly app: INestApplication) {}

  async login(account: string, password: string): Promise<void> {
    const captchaRes = await request(this.app.getHttpServer()).post('/api/auth/captcha').expect(201)
    const { captchaId } = captchaRes.body.data
    const loginRes = await request(this.app.getHttpServer())
      .post('/api/auth/login')
      .send({ account, password, captchaId, captchaCode: 'test' })
    this.accessToken = loginRes.body?.data?.accessToken ?? null
  }

  post(path: string) {
    const req = request(this.app.getHttpServer()).post(path)
    if (this.accessToken) {
      req.set('Authorization', `Bearer ${this.accessToken}`)
    }
    return req
  }

  async waitForBacktest(runId: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const res = await this.post('/api/backtest/runs/detail').send({ runId })
      const status = res.body?.data?.status
      if (status === 'COMPLETED') return
      if (status === 'FAILED') throw new Error(`回测失败: ${runId}`)
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`回测超时（${timeoutMs}ms）: ${runId}`)
  }
}
