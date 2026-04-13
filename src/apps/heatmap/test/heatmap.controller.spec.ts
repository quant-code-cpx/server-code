import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common'
import request from 'supertest'
import { UserRole } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { HeatmapController } from '../heatmap.controller'
import { HeatmapService } from '../heatmap.service'
import { HeatmapSnapshotService } from '../heatmap-snapshot.service'

const superAdminUser = { id: 1, account: 'admin', nickname: 'Admin', role: UserRole.SUPER_ADMIN, jti: 'jti-1' }

const mockRolesGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest()
    req.user = superAdminUser
    return true
  }),
}

const mockHeatmapService = {
  getHeatmap: jest.fn(),
}

const mockHeatmapSnapshotService = {
  aggregateSnapshot: jest.fn(),
  queryHistory: jest.fn(),
}

const SUCCESS_CODE = 0

describe('HeatmapController', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HeatmapController],
      providers: [
        { provide: HeatmapService, useValue: mockHeatmapService },
        { provide: HeatmapSnapshotService, useValue: mockHeatmapSnapshotService },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile()

    app = module.createNestApplication()
    app.useGlobalInterceptors(new TransformInterceptor())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => app.close())
  beforeEach(() => jest.clearAllMocks())

  it('POST /heatmap/data → 201, data is array', async () => {
    const mockData = [{ industry: '银行', avgChange: 1.2 }]
    mockHeatmapService.getHeatmap.mockResolvedValueOnce(mockData)

    await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(Array.isArray(res.body.data)).toBe(true)
      })
  })

  it('POST /heatmap/snapshot/trigger → 201', async () => {
    const mockResult = { date: '20231201', processed: 4500 }
    mockHeatmapSnapshotService.aggregateSnapshot.mockResolvedValueOnce(mockResult)

    await request(app.getHttpServer())
      .post('/heatmap/snapshot/trigger')
      .send({ trade_date: '20231201' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /heatmap/snapshot/history → 201', async () => {
    const mockHistory = { trade_date: '20231201', groups: [] }
    mockHeatmapSnapshotService.queryHistory.mockResolvedValueOnce(mockHistory)

    await request(app.getHttpServer())
      .post('/heatmap/snapshot/history')
      .send({ trade_date: '20231201' })
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })
})
