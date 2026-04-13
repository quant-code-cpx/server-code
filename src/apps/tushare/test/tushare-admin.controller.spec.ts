import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe, ExecutionContext } from '@nestjs/common'
import request from 'supertest'
import { UserRole } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { TushareAdminController } from '../tushare-admin.controller'
import { TushareSyncService } from 'src/tushare/sync/sync.service'
import { DataQualityService } from 'src/tushare/sync/quality/data-quality.service'
import { CrossTableCheckService } from 'src/tushare/sync/quality/cross-table-check.service'
import { AutoRepairService } from 'src/tushare/sync/quality/auto-repair.service'
import { SyncLogService } from 'src/tushare/sync/sync-log.service'
import { SyncStatusOverviewService } from 'src/tushare/sync/sync-status-overview.service'
import { PrismaService } from 'src/shared/prisma.service'

const superAdminUser = { id: 1, account: 'admin', nickname: 'Admin', role: UserRole.SUPER_ADMIN, jti: 'jti-1' }

const mockJwtGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest()
    req.user = superAdminUser
    return true
  }),
}

const mockRolesGuard = {
  canActivate: jest.fn(() => true),
}

const mockTushareSyncService = {
  getAvailableSyncPlans: jest.fn(),
  getCacheStats: jest.fn(),
  triggerManualSyncAsync: jest.fn(),
}

const mockDataQualityService = {
  runAllChecks: jest.fn(),
  getRecentChecks: jest.fn(),
  getDataGaps: jest.fn(),
  getValidationLogs: jest.fn(),
  getRecentReportsAsQualityReports: jest.fn(),
}

const mockCrossTableCheckService = {
  runAllCrossChecks: jest.fn(),
}

const mockAutoRepairService = {
  analyzeAndRepair: jest.fn(),
}

const mockSyncLogService = {
  queryLogs: jest.fn(),
  summarizeLogs: jest.fn(),
}

const mockSyncStatusOverviewService = {
  getOverview: jest.fn(),
}

const mockPrismaService = {
  tushareSyncRetryQueue: {
    count: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  dataQualityCheck: {
    findMany: jest.fn(),
  },
}

const SUCCESS_CODE = 0

describe('TushareAdminController', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TushareAdminController],
      providers: [
        { provide: TushareSyncService, useValue: mockTushareSyncService },
        { provide: DataQualityService, useValue: mockDataQualityService },
        { provide: CrossTableCheckService, useValue: mockCrossTableCheckService },
        { provide: AutoRepairService, useValue: mockAutoRepairService },
        { provide: SyncLogService, useValue: mockSyncLogService },
        { provide: SyncStatusOverviewService, useValue: mockSyncStatusOverviewService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
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

  it('POST /tushare/admin/plans → 201 with code 200000', async () => {
    const mockPlans = [{ name: 'DAILY', description: '日线行情' }]
    mockTushareSyncService.getAvailableSyncPlans.mockResolvedValueOnce(mockPlans)

    await request(app.getHttpServer())
      .post('/tushare/admin/plans')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })

  it('POST /tushare/admin/sync → 202', async () => {
    mockTushareSyncService.triggerManualSyncAsync.mockReturnValueOnce(undefined)

    await request(app.getHttpServer())
      .post('/tushare/admin/sync')
      .send({ mode: 'incremental' })
      .expect(202)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
      })
  })

  it('POST /tushare/admin/quality/check → 202', async () => {
    mockDataQualityService.runAllChecks.mockResolvedValueOnce(undefined)

    await request(app.getHttpServer())
      .post('/tushare/admin/quality/check')
      .send({})
      .expect(202)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
      })
  })

  it('POST /tushare/admin/cache/stats → 201', async () => {
    const mockStats = { hitRate: 0.85, totalKeys: 120 }
    mockTushareSyncService.getCacheStats.mockResolvedValueOnce(mockStats)

    await request(app.getHttpServer())
      .post('/tushare/admin/cache/stats')
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.code).toBe(SUCCESS_CODE)
        expect(res.body.data).toBeDefined()
      })
  })
})
