import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import request from 'supertest'
import { UserRole, TushareSyncRetryStatus } from '@prisma/client'
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
import { TushareSyncTaskName } from 'src/constant/tushare.constant'

// ─── Mock 用户 ────────────────────────────────────────────────────────────────
const superAdminUser = {
  id: 1,
  account: 'admin',
  nickname: 'Admin',
  role: UserRole.SUPER_ADMIN,
  jti: 'jti-1',
}

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

// ─── Mock 服务 ────────────────────────────────────────────────────────────────
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

// ─── 测试套件 ─────────────────────────────────────────────────────────────────
describe('TushareAdminController (tushare-api)', () => {
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. 同步计划 & 缓存
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /tushare/admin/plans', () => {
    it('[BIZ] TA-BIZ-001 获取同步计划列表 → 200', async () => {
      const mockPlans = [
        {
          task: 'DAILY',
          label: '日线行情',
          category: 'market',
          bootstrapEnabled: true,
          supportsManual: true,
          supportsFullSync: true,
          requiresTradeDate: true,
          schedule: null,
        },
      ]
      mockTushareSyncService.getAvailableSyncPlans.mockResolvedValueOnce(mockPlans)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/plans')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data).toBeDefined()
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(mockTushareSyncService.getAvailableSyncPlans).toHaveBeenCalledTimes(1)
    })
  })

  describe('POST /tushare/admin/cache/stats', () => {
    it('[BIZ] TA-BIZ-002 获取缓存统计 → 200', async () => {
      const mockStats = {
        generatedAt: new Date().toISOString(),
        namespaces: [
          {
            namespace: 'tushare',
            keyCount: 120,
            hits: 500,
            misses: 50,
            writes: 100,
            invalidations: 10,
            hitRate: 90.9,
            lastHitAt: null,
            lastMissAt: null,
            lastWriteAt: null,
            lastInvalidatedAt: null,
          },
        ],
      }
      mockTushareSyncService.getCacheStats.mockResolvedValueOnce(mockStats)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/cache/stats')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data).toBeDefined()
      expect(mockTushareSyncService.getCacheStats).toHaveBeenCalledTimes(1)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. 手动同步
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /tushare/admin/sync', () => {
    it('[BIZ] TA-BIZ-003 增量同步 → 202', async () => {
      mockTushareSyncService.triggerManualSyncAsync.mockReturnValueOnce(undefined)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/sync')
        .send({ mode: 'incremental' })
        .expect(202)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.message).toContain('同步任务已提交')
      expect(mockTushareSyncService.triggerManualSyncAsync).toHaveBeenCalledWith({ mode: 'incremental' })
    })

    it('[BIZ] TA-BIZ-004 全量同步 → 202', async () => {
      mockTushareSyncService.triggerManualSyncAsync.mockReturnValueOnce(undefined)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/sync')
        .send({ mode: 'full' })
        .expect(202)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockTushareSyncService.triggerManualSyncAsync).toHaveBeenCalledWith({ mode: 'full' })
    })

    it('[BIZ] TA-BIZ-005 指定任务同步 → 202', async () => {
      mockTushareSyncService.triggerManualSyncAsync.mockReturnValueOnce(undefined)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/sync')
        .send({ mode: 'incremental', tasks: [TushareSyncTaskName.DAILY, TushareSyncTaskName.DIVIDEND] })
        .expect(202)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockTushareSyncService.triggerManualSyncAsync).toHaveBeenCalledWith({
        mode: 'incremental',
        tasks: [TushareSyncTaskName.DAILY, TushareSyncTaskName.DIVIDEND],
      })
    })

    it('[ERR] TA-ERR-001 mode 缺失 → 400', async () => {
      await request(app.getHttpServer())
        .post('/tushare/admin/sync')
        .send({})
        .expect(400)

      expect(mockTushareSyncService.triggerManualSyncAsync).not.toHaveBeenCalled()
    })

    it('[ERR] TA-ERR-002 mode 非法值 → 400', async () => {
      await request(app.getHttpServer())
        .post('/tushare/admin/sync')
        .send({ mode: 'INVALID' })
        .expect(400)

      expect(mockTushareSyncService.triggerManualSyncAsync).not.toHaveBeenCalled()
    })

    it('[ERR] TA-ERR-003 tasks 包含非法枚举值 → 400', async () => {
      await request(app.getHttpServer())
        .post('/tushare/admin/sync')
        .send({ mode: 'incremental', tasks: ['INVALID_TASK'] })
        .expect(400)

      expect(mockTushareSyncService.triggerManualSyncAsync).not.toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. 质量检查
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /tushare/admin/quality/check', () => {
    it('[BIZ] TA-BIZ-006 触发质量检查 → 202', async () => {
      mockDataQualityService.runAllChecks.mockResolvedValueOnce(undefined)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/quality/check')
        .send({})
        .expect(202)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.message).toContain('数据质量检查已提交')
    })
  })

  describe('POST /tushare/admin/quality/report', () => {
    it('[BIZ] TA-BIZ-007 查询质量报告（默认 7 天）→ 200', async () => {
      mockDataQualityService.getRecentChecks.mockResolvedValueOnce([])

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/quality/report')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockDataQualityService.getRecentChecks).toHaveBeenCalledWith(7)
    })

    it('[BIZ] TA-BIZ-008 查询质量报告（自定义天数）→ 200', async () => {
      mockDataQualityService.getRecentChecks.mockResolvedValueOnce([])

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/quality/report')
        .send({ days: 30 })
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockDataQualityService.getRecentChecks).toHaveBeenCalledWith(30)
    })
  })

  describe('POST /tushare/admin/quality/gaps', () => {
    it('[BIZ] TA-BIZ-009 查询数据缺失 → 200', async () => {
      mockDataQualityService.getDataGaps.mockResolvedValueOnce({ gaps: ['2026-01-01'] })

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/quality/gaps')
        .send({ dataSet: 'daily' })
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockDataQualityService.getDataGaps).toHaveBeenCalledWith('daily')
    })
  })

  describe('POST /tushare/admin/quality/cross-check', () => {
    it('[BIZ] TA-BIZ-010 跨表一致性对账（recent 模式）→ 200', async () => {
      mockCrossTableCheckService.runAllCrossChecks.mockResolvedValueOnce([])

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/quality/cross-check')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockCrossTableCheckService.runAllCrossChecks).toHaveBeenCalledWith('recent')
    })

    it('[BIZ] TA-BIZ-011 跨表一致性对账（full 模式）→ 200', async () => {
      mockCrossTableCheckService.runAllCrossChecks.mockResolvedValueOnce([])

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/quality/cross-check')
        .send({ mode: 'full' })
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockCrossTableCheckService.runAllCrossChecks).toHaveBeenCalledWith('full')
    })
  })

  describe('POST /tushare/admin/quality/repair', () => {
    it('[BIZ] TA-BIZ-012 触发自动补数 → 200', async () => {
      mockDataQualityService.getRecentReportsAsQualityReports.mockResolvedValueOnce([])
      mockAutoRepairService.analyzeAndRepair.mockResolvedValueOnce({ repaired: 0 })

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/quality/repair')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockAutoRepairService.analyzeAndRepair).toHaveBeenCalled()
    })
  })

  describe('POST /tushare/admin/quality/repair-status', () => {
    it('[BIZ] TA-BIZ-013 查看补数队列状态 → 200', async () => {
      mockPrismaService.tushareSyncRetryQueue.count
        .mockResolvedValueOnce(5)  // pending
        .mockResolvedValueOnce(2)  // retrying
        .mockResolvedValueOnce(10) // succeeded
        .mockResolvedValueOnce(1)  // exhausted

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/quality/repair-status')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data).toEqual({ pending: 5, retrying: 2, succeeded: 10, exhausted: 1 })
    })
  })

  describe('POST /tushare/admin/quality/summary', () => {
    it('[BIZ] TA-BIZ-014 质量检查汇总 → 200', async () => {
      const mockChecks = [
        { dataSet: 'daily', checkType: 'row-count', status: 'pass', message: null, createdAt: new Date() },
        { dataSet: 'daily', checkType: 'cross-table', status: 'fail', message: 'mismatch', createdAt: new Date() },
      ]
      mockPrismaService.dataQualityCheck.findMany.mockResolvedValueOnce(mockChecks)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/quality/summary')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data.totalChecks).toBe(2)
      expect(res.body.data.counts.pass).toBe(1)
      expect(res.body.data.failures).toHaveLength(1)
    })
  })

  describe('POST /tushare/admin/quality/health', () => {
    it('[BIZ] TA-BIZ-015 数据质量健康状态 → 200', async () => {
      mockPrismaService.dataQualityCheck.findMany.mockResolvedValueOnce([])
      mockPrismaService.tushareSyncRetryQueue.count.mockResolvedValueOnce(0)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/quality/health')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data.status).toBe('healthy')
      expect(res.body.data.failCount).toBe(0)
      expect(res.body.data.exhaustedRepairs).toBe(0)
    })

    it('[BIZ] TA-BIZ-015b 数据质量 degraded 状态', async () => {
      const mockChecks = [
        { status: 'fail', createdAt: new Date(), checkType: 'row-count', dataSet: 'daily', message: 'err' },
      ]
      mockPrismaService.dataQualityCheck.findMany.mockResolvedValueOnce(mockChecks)
      mockPrismaService.tushareSyncRetryQueue.count.mockResolvedValueOnce(0)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/quality/health')
        .send({})
        .expect(201)

      expect(res.body.data.status).toBe('degraded')
      expect(res.body.data.failCount).toBe(1)
    })

    it('[BIZ] TA-BIZ-015c 数据质量 unhealthy 状态', async () => {
      const mockChecks = Array.from({ length: 6 }, () => ({
        status: 'fail',
        createdAt: new Date(),
        checkType: 'row-count',
        dataSet: 'daily',
        message: 'err',
      }))
      mockPrismaService.dataQualityCheck.findMany.mockResolvedValueOnce(mockChecks)
      mockPrismaService.tushareSyncRetryQueue.count.mockResolvedValueOnce(0)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/quality/health')
        .send({})
        .expect(201)

      expect(res.body.data.status).toBe('unhealthy')
    })
  })

  describe('POST /tushare/admin/validation-logs', () => {
    it('[BIZ] TA-BIZ-016 查询校验异常日志 → 200', async () => {
      mockDataQualityService.getValidationLogs.mockResolvedValueOnce([])

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/validation-logs')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockDataQualityService.getValidationLogs).toHaveBeenCalledWith({ task: undefined, limit: undefined })
    })

    it('[BIZ] TA-BIZ-016b 查询校验异常日志（带参数）→ 200', async () => {
      mockDataQualityService.getValidationLogs.mockResolvedValueOnce([])

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/validation-logs')
        .send({ task: 'DAILY', limit: 50 })
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockDataQualityService.getValidationLogs).toHaveBeenCalledWith({ task: 'DAILY', limit: 50 })
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. 同步日志
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /tushare/admin/sync-logs', () => {
    it('[BIZ] TA-BIZ-017 查询同步日志（无过滤）→ 200', async () => {
      mockSyncLogService.queryLogs.mockResolvedValueOnce({ items: [], total: 0 })

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/sync-logs')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockSyncLogService.queryLogs).toHaveBeenCalled()
    })

    it('[BIZ] TA-BIZ-018 查询同步日志（按任务过滤）→ 200', async () => {
      mockSyncLogService.queryLogs.mockResolvedValueOnce({ items: [], total: 0 })

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/sync-logs')
        .send({ task: TushareSyncTaskName.DAILY })
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
    })

    it('[ERR] TA-ERR-004 startDate 格式错误 → 400', async () => {
      await request(app.getHttpServer())
        .post('/tushare/admin/sync-logs')
        .send({ startDate: 'not-a-date' })
        .expect(400)

      expect(mockSyncLogService.queryLogs).not.toHaveBeenCalled()
    })

    it('[EDGE] TA-EDGE-001 pageSize=100（最大）→ 200', async () => {
      mockSyncLogService.queryLogs.mockResolvedValueOnce({ items: [], total: 0 })

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/sync-logs')
        .send({ pageSize: 100 })
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
    })

    it('[EDGE] TA-EDGE-002 pageSize=101 → 400', async () => {
      await request(app.getHttpServer())
        .post('/tushare/admin/sync-logs')
        .send({ pageSize: 101 })
        .expect(400)

      expect(mockSyncLogService.queryLogs).not.toHaveBeenCalled()
    })
  })

  describe('POST /tushare/admin/sync-logs/summary', () => {
    it('[BIZ] TA-BIZ-019 同步日志汇总 → 200', async () => {
      mockSyncLogService.summarizeLogs.mockResolvedValueOnce([])

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/sync-logs/summary')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockSyncLogService.summarizeLogs).toHaveBeenCalledTimes(1)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. 重试队列
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /tushare/admin/retry-queue', () => {
    it('[BIZ] TA-BIZ-020 查询重试队列（默认分页）→ 200', async () => {
      mockPrismaService.tushareSyncRetryQueue.count.mockResolvedValueOnce(0)
      mockPrismaService.tushareSyncRetryQueue.findMany.mockResolvedValueOnce([])

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/retry-queue')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data.total).toBe(0)
      expect(res.body.data.page).toBe(1)
      expect(res.body.data.pageSize).toBe(20)
      expect(res.body.data.items).toEqual([])
    })

    it('[BIZ] TA-BIZ-021 查询重试队列（按状态过滤）→ 200', async () => {
      mockPrismaService.tushareSyncRetryQueue.count.mockResolvedValueOnce(3)
      mockPrismaService.tushareSyncRetryQueue.findMany.mockResolvedValueOnce([
        { id: 1, status: 'PENDING' },
        { id: 2, status: 'PENDING' },
        { id: 3, status: 'PENDING' },
      ])

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/retry-queue')
        .send({ status: 'PENDING' })
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data.total).toBe(3)
    })

    it('[EDGE] TA-EDGE-003 pageSize 超 100 自动截断 → 200, pageSize=100', async () => {
      mockPrismaService.tushareSyncRetryQueue.count.mockResolvedValueOnce(0)
      mockPrismaService.tushareSyncRetryQueue.findMany.mockResolvedValueOnce([])

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/retry-queue')
        .send({ pageSize: 200 })
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data.pageSize).toBe(100)
    })
  })

  describe('POST /tushare/admin/retry-queue/reset', () => {
    it('[BIZ] TA-BIZ-022 重置耗尽重试记录 → 200', async () => {
      mockPrismaService.tushareSyncRetryQueue.updateMany.mockResolvedValueOnce({ count: 5 })

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/retry-queue/reset')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data.message).toContain('5')
    })

    it('[BIZ] TA-BIZ-023 重置指定任务的重试记录 → 200', async () => {
      mockPrismaService.tushareSyncRetryQueue.updateMany.mockResolvedValueOnce({ count: 2 })

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/retry-queue/reset')
        .send({ task: 'DAILY' })
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data.message).toContain('2')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. 状态总览
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /tushare/admin/sync-status-overview', () => {
    const mockOverview = {
      totalRows: 100000,
      totalMissingDays: 0,
      categories: [
        {
          name: 'market',
          items: [
            {
              table: 'tushare_daily',
              rowCount: 50000,
              minDate: '2020-01-01',
              maxDate: '2026-05-23',
              missingDays: 0,
              consecutiveFailures: 0,
              lastSyncAt: new Date(),
            },
          ],
        },
      ],
    }

    it('[BIZ] TA-BIZ-024 获取同步状态总览（默认缓存）→ 200', async () => {
      mockSyncStatusOverviewService.getOverview.mockResolvedValueOnce(mockOverview)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/sync-status-overview')
        .send({})
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(res.body.data.healthStatus).toBeDefined()
      expect(res.body.data.syncStats).toBeDefined()
      expect(res.body.data.categories).toBeDefined()
      expect(mockSyncStatusOverviewService.getOverview).toHaveBeenCalled()
      expect(mockSyncStatusOverviewService.refresh).not.toHaveBeenCalled()
    })

    it('[BIZ] TA-BIZ-025 强制刷新同步状态总览 → 200', async () => {
      mockSyncStatusOverviewService.refresh.mockResolvedValueOnce(mockOverview)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/sync-status-overview')
        .send({ refresh: true })
        .expect(201)

      expect(res.body.code).toBe(SUCCESS_CODE)
      expect(mockSyncStatusOverviewService.refresh).toHaveBeenCalled()
      expect(mockSyncStatusOverviewService.getOverview).not.toHaveBeenCalled()
    })

    it('[BIZ] TA-BIZ-025b 总览派生字段正确性', async () => {
      const overviewWithMissing = {
        ...mockOverview,
        totalMissingDays: 30,
        categories: [
          {
            name: 'market',
            items: [
              {
                table: 'tushare_daily',
                rowCount: 50000,
                minDate: '2020-01-01',
                maxDate: '2026-05-23',
                missingDays: 30,
                consecutiveFailures: 2,
                lastSyncAt: new Date(),
              },
            ],
          },
        ],
      }
      mockSyncStatusOverviewService.getOverview.mockResolvedValueOnce(overviewWithMissing)

      const res = await request(app.getHttpServer())
        .post('/tushare/admin/sync-status-overview')
        .send({})
        .expect(201)

      expect(res.body.data.healthStatus).toBe('DEGRADED')
      expect(res.body.data.syncStats.totalTables).toBe(1)
      expect(res.body.data.syncStats.healthyTables).toBe(0)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. 安全
  // ═══════════════════════════════════════════════════════════════════════════

  describe('安全测试', () => {
    it('[SEC] TA-SEC-001 无 Token 访问 → 401', async () => {
      mockRolesGuard.canActivate.mockImplementationOnce(() => {
        throw new UnauthorizedException()
      })

      await request(app.getHttpServer())
        .post('/tushare/admin/plans')
        .send({})
        .expect(401)

      expect(mockTushareSyncService.getAvailableSyncPlans).not.toHaveBeenCalled()
    })

    it('[SEC] TA-SEC-002 非 SUPER_ADMIN 访问 → 403', async () => {
      mockRolesGuard.canActivate.mockImplementationOnce(() => false)

      await request(app.getHttpServer())
        .post('/tushare/admin/plans')
        .send({})
        .expect(403)

      expect(mockTushareSyncService.getAvailableSyncPlans).not.toHaveBeenCalled()
    })
  })
})
