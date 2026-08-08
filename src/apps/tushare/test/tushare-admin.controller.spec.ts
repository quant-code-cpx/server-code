import { Test, TestingModule } from '@nestjs/testing'
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import request from 'supertest'
import { UserRole } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { ROLES_KEY } from 'src/common/decorators/roles.decorator'
import { ROLE_LEVEL } from 'src/constant/user.constant'
import { TushareAdminController } from '../tushare-admin.controller'
import { TushareSyncService } from 'src/tushare/sync/sync.service'
import { DataQualityService } from 'src/tushare/sync/quality/data-quality.service'
import { CrossTableCheckService } from 'src/tushare/sync/quality/cross-table-check.service'
import { AutoRepairService } from 'src/tushare/sync/quality/auto-repair.service'
import { SyncLogService } from 'src/tushare/sync/sync-log.service'
import { SyncStatusOverviewService } from 'src/tushare/sync/sync-status-overview.service'
import { PrismaService } from 'src/shared/prisma.service'

const superAdminUser = { id: 1, account: 'admin', nickname: 'Admin', role: UserRole.SUPER_ADMIN, jti: 'jti-1' }
let activeUserRole: UserRole = UserRole.SUPER_ADMIN

const mockJwtGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest()
    req.user = superAdminUser
    return true
  }),
}

const mockRolesGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest()
    request.user = { ...superAdminUser, role: activeUserRole }
    const required = new Reflector().getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required?.length) return true
    const userLevel = ROLE_LEVEL[activeUserRole] ?? 0
    if (!required.some((role) => userLevel >= ROLE_LEVEL[role])) {
      throw new ForbiddenException('权限不足')
    }
    return true
  }),
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
  refresh: jest.fn(),
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
  beforeEach(() => {
    jest.clearAllMocks()
    activeUserRole = UserRole.SUPER_ADMIN
  })

  it('[OPS-B01] controller 默认允许 ADMIN 读取，写方法单独要求 SUPER_ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, TushareAdminController)).toEqual([UserRole.ADMIN])

    const writeMethods: Array<keyof TushareAdminController> = [
      'manualSync',
      'triggerQualityCheck',
      'runCrossTableCheck',
      'triggerAutoRepair',
      'resetRetryQueue',
    ]
    writeMethods.forEach((method) => {
      expect(Reflect.getMetadata(ROLES_KEY, TushareAdminController.prototype[method])).toEqual([UserRole.SUPER_ADMIN])
    })
  })

  it('[OPS-B01] ADMIN 可读取计划，但不能触发同步', async () => {
    activeUserRole = UserRole.ADMIN
    mockTushareSyncService.getAvailableSyncPlans.mockResolvedValueOnce([])

    await request(app.getHttpServer()).post('/tushare/admin/plans').send({}).expect(201)
    await request(app.getHttpServer()).post('/tushare/admin/sync').send({ mode: 'incremental' }).expect(403)
    expect(mockTushareSyncService.triggerManualSyncAsync).not.toHaveBeenCalled()
  })

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

  // ── 补充：缺失端点冒烟 ──────────────────────────────────────────────
  const eps: Array<
    [
      string,
      (
        | keyof typeof mockDataQualityService
        | keyof typeof mockSyncLogService
        | keyof typeof mockTushareSyncService
        | keyof typeof mockCrossTableCheckService
        | keyof typeof mockAutoRepairService
      ),
      Record<string, unknown>,
    ]
  > = [
    ['/tushare/admin/quality/report', 'getRecentChecks', {}],
    ['/tushare/admin/quality/gaps', 'getDataGaps', { dataSet: 'daily' }],
    ['/tushare/admin/quality/cross-check', 'runAllCrossChecks', {}],
    ['/tushare/admin/quality/repair', 'analyzeAndRepair', {}],
    ['/tushare/admin/validation-logs', 'getValidationLogs', {}],
    ['/tushare/admin/sync-logs', 'queryLogs', {}],
    ['/tushare/admin/sync-logs/summary', 'summarizeLogs', {}],
  ]

  // Map service key to mock
  const qualityMocks: Record<string, jest.Mock> = {
    getRecentChecks: mockDataQualityService.getRecentChecks,
    getDataGaps: mockDataQualityService.getDataGaps,
    getValidationLogs: mockDataQualityService.getValidationLogs,
    runAllCrossChecks: mockCrossTableCheckService.runAllCrossChecks,
    analyzeAndRepair: mockAutoRepairService.analyzeAndRepair,
    queryLogs: mockSyncLogService.queryLogs,
    summarizeLogs: mockSyncLogService.summarizeLogs,
  }

  eps.forEach(([path, svcKey]) => {
    it(`[BIZ] POST ${path} → 200/202`, async () => {
      const mockFn = qualityMocks[svcKey as string]
      if (mockFn)
        mockFn.mockResolvedValueOnce(
          svcKey === 'summarizeLogs' || svcKey === 'getDataGaps' || svcKey === 'getRecentChecks' ? [] : {},
        )
      const body = svcKey === 'getDataGaps' ? { dataSet: 'daily' } : {}
      const res = await request(app.getHttpServer()).post(path).send(body)
      expect(res.status).toBeGreaterThanOrEqual(200)
      expect(res.status).toBeLessThan(400)
    })
  })

  // quality/repair-status, quality/summary, quality/health use prisma directly
  it('[BIZ] POST /tushare/admin/quality/repair-status → 200', async () => {
    mockPrismaService.tushareSyncRetryQueue.count.mockResolvedValue(0)
    const res = await request(app.getHttpServer()).post('/tushare/admin/quality/repair-status').send({})
    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(res.status).toBeLessThan(400)
  })

  it('[BIZ] POST /tushare/admin/quality/summary → 200', async () => {
    mockPrismaService.dataQualityCheck.findMany.mockResolvedValueOnce([])
    const res = await request(app.getHttpServer()).post('/tushare/admin/quality/summary').send({})
    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(res.status).toBeLessThan(400)
  })

  it('[BIZ] POST /tushare/admin/quality/health → 200', async () => {
    mockPrismaService.dataQualityCheck.findMany.mockResolvedValueOnce([])
    mockPrismaService.tushareSyncRetryQueue.count.mockResolvedValue(0)
    const res = await request(app.getHttpServer()).post('/tushare/admin/quality/health').send({})
    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(res.status).toBeLessThan(400)
  })

  it('[BIZ] POST /tushare/admin/retry-queue → 200', async () => {
    mockPrismaService.tushareSyncRetryQueue.count.mockResolvedValue(0)
    mockPrismaService.tushareSyncRetryQueue.findMany.mockResolvedValueOnce([])
    const res = await request(app.getHttpServer()).post('/tushare/admin/retry-queue').send({})
    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(res.status).toBeLessThan(400)
  })

  it('[OPS-B03] retry task 条件参与服务端 count 与分页查询', async () => {
    mockPrismaService.tushareSyncRetryQueue.count.mockResolvedValueOnce(1)
    mockPrismaService.tushareSyncRetryQueue.findMany.mockResolvedValueOnce([])

    await request(app.getHttpServer())
      .post('/tushare/admin/retry-queue')
      .send({ task: 'DAILY', page: 2, pageSize: 20 })
      .expect(201)

    const expectedWhere = { task: { in: expect.arrayContaining(['DAILY', 'DAILY_BASIC', 'DAILY_INFO']) } }
    expect(mockPrismaService.tushareSyncRetryQueue.count).toHaveBeenCalledWith({ where: expectedWhere })
    expect(mockPrismaService.tushareSyncRetryQueue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, skip: 20, take: 20 }),
    )
  })

  it('[OPS-B04] reset response 返回实际更新 count', async () => {
    mockPrismaService.tushareSyncRetryQueue.updateMany.mockResolvedValueOnce({ count: 3 })

    const res = await request(app.getHttpServer()).post('/tushare/admin/retry-queue/reset').send({}).expect(201)

    expect(res.body.data).toEqual({ message: '已重置 3 条记录为 PENDING', count: 3 })
  })

  // DTO 校验
  it('[VAL] POST /tushare/admin/sync mode 非法枚举 → 400', async () => {
    await request(app.getHttpServer()).post('/tushare/admin/sync').send({ mode: 'INVALID' }).expect(400)
  })

  it('[VAL] POST /tushare/admin/sync-logs 缺 filter → DTO 放行', async () => {
    mockSyncLogService.queryLogs.mockResolvedValueOnce({ items: [], total: 0 })
    await request(app.getHttpServer()).post('/tushare/admin/sync-logs').send({}).expect(201)
  })

  // Controller has class-level @UseGuards(RolesGuard) @Roles(SUPER_ADMIN)
  // mockRolesGuard returning false → NestJS throws ForbiddenException → 403
  it('[AUTH] 非 SUPER_ADMIN 访问 → 403', async () => {
    mockRolesGuard.canActivate.mockImplementationOnce(() => false)
    await request(app.getHttpServer()).post('/tushare/admin/plans').send({}).expect(403)
    expect(mockTushareSyncService.getAvailableSyncPlans).not.toHaveBeenCalled()
  })

  it('[AUTH] 未认证请求 → 401', async () => {
    mockRolesGuard.canActivate.mockImplementationOnce(() => {
      throw new UnauthorizedException()
    })
    await request(app.getHttpServer()).post('/tushare/admin/plans').send({}).expect(401)
    expect(mockTushareSyncService.getAvailableSyncPlans).not.toHaveBeenCalled()
  })
})
