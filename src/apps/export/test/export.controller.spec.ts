import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common'
import request from 'supertest'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { UserRole } from '@prisma/client'
import { ExportController } from '../export.controller'
import { ExportService } from '../export.service'

const testUser = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }
const mockExportService = {
  exportBacktestTrades: jest.fn(), exportFactorValues: jest.fn(), exportPortfolioHoldings: jest.fn(),
  exportStockList: jest.fn(), exportAlertAnomalies: jest.fn(), exportFactorScreening: jest.fn(),
}
const mockJwtGuard = { canActivate: jest.fn((ctx: ExecutionContext) => { ctx.switchToHttp().getRequest().user = testUser; return true }) }

describe('ExportController', () => {
  let app: INestApplication
  beforeAll(async () => {
    const m = await Test.createTestingModule({
      controllers: [ExportController], providers: [{ provide: ExportService, useValue: mockExportService }],
    }).overrideGuard(JwtAuthGuard).useValue(mockJwtGuard).compile()
    app = m.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    app.useGlobalInterceptors(new TransformInterceptor())
    await app.init()
  })
  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  const ep = (path: string, svcKey: keyof typeof mockExportService, body: Record<string, unknown>) => {
    it(`[BIZ] POST /export/${path} → service called`, async () => {
      ;(mockExportService[svcKey] as jest.Mock).mockResolvedValueOnce({ filename: 't.csv', csv: 'a,b' })
      // export endpoints use @Res({passthrough:true}) returning raw CSV
      const res = await request(app.getHttpServer()).post(`/export/${path}`).send(body)
      expect(res.status).toBeGreaterThanOrEqual(200)
      expect(res.status).toBeLessThan(400)
      expect(mockExportService[svcKey]).toHaveBeenCalled()
    })
  }

  ep('backtest-trades', 'exportBacktestTrades', { runId: 'r-1' })
  ep('factor-values', 'exportFactorValues', { factorId: 'f-1' })
  ep('portfolio-holdings', 'exportPortfolioHoldings', { portfolioId: 'p-1' })
  ep('stock-list', 'exportStockList', {})
  ep('alert-anomalies', 'exportAlertAnomalies', {})
    ep('factor-screening', 'exportFactorScreening', { conditions: [{ factorName: 'pe_ttm', operator: 'gt', value: 0 }], tradeDate: '20240101' })
})
