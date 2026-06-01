import { Test, TestingModule } from '@nestjs/testing'
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common'
import request from 'supertest'
import { Reflector } from '@nestjs/core'
import { UserRole } from '@prisma/client'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { ROLES_KEY } from 'src/common/decorators/roles.decorator'
import { ROLE_LEVEL } from 'src/constant/user.constant'
import { TokenPayload } from 'src/shared/token.interface'
import { HeatmapController } from '../heatmap.controller'
import { HeatmapService } from '../heatmap.service'
import { HeatmapSnapshotService } from '../heatmap-snapshot.service'

// ── Mock 服务 ────────────────────────────────────────────────────────────────

const mockHeatmapService = {
  getHeatmap: jest.fn(),
}

const mockSnapshotService = {
  aggregateSnapshot: jest.fn(),
  queryHistory: jest.fn(),
}

const allProviders = [
  { provide: HeatmapService, useValue: mockHeatmapService },
  { provide: HeatmapSnapshotService, useValue: mockSnapshotService },
]

// ── 用户载荷 ──────────────────────────────────────────────────────────────────

const userPayload: TokenPayload = { id: 1, account: 'test', nickname: 'Test', role: UserRole.USER, jti: 'jti-1' }
const adminPayload: TokenPayload = { id: 2, account: 'admin', nickname: 'Admin', role: UserRole.ADMIN, jti: 'jti-2' }
const superAdminPayload: TokenPayload = { id: 3, account: 'superadmin', nickname: 'SuperAdmin', role: UserRole.SUPER_ADMIN, jti: 'jti-3' }

// ── 构建测试应用 ──────────────────────────────────────────────────────────────

async function buildHeatmapApp(user: TokenPayload | null): Promise<INestApplication> {
  const customRolesGuard = {
    canActivate(ctx: ExecutionContext): boolean {
      if (!user) throw new UnauthorizedException('用户未登录')
      const req = ctx.switchToHttp().getRequest()
      req.user = user

      const reflector = new Reflector()
      const required = reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()])
      if (!required?.length) return true

      const level = ROLE_LEVEL[user.role] ?? 0
      const meets = required.some((r) => level >= ROLE_LEVEL[r])
      if (!meets) throw new ForbiddenException('权限不足')
      return true
    },
  }

  const module: TestingModule = await Test.createTestingModule({
    controllers: [HeatmapController],
    providers: [...allProviders, Reflector],
  })
    .overrideGuard(RolesGuard)
    .useValue(customRolesGuard)
    .compile()

  const app = module.createNestApplication()
  app.useGlobalInterceptors(new TransformInterceptor())
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.init()
  return app
}

// ── 示例数据 ──────────────────────────────────────────────────────────────────

const sampleHeatmapItems = [
  { tsCode: '000001.SZ', name: '平安银行', groupName: '银行', industry: '银行', pctChg: 1.5, totalMv: 2000000, amount: 50000 },
  { tsCode: '600519.SH', name: '贵州茅台', groupName: '白酒', industry: '白酒', pctChg: -0.8, totalMv: 1500000, amount: 30000 },
]

const sampleHistoryResponse = {
  tradeDate: '20260404',
  groupBy: 'industry',
  stockCount: 2,
  isFromSnapshot: true,
  items: sampleHeatmapItems,
}

// ═══════════════════════════════════════════════════════════════════════════════
// [BIZ] 正常业务路径
// ═══════════════════════════════════════════════════════════════════════════════

describe('HeatmapController [BIZ]', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await buildHeatmapApp(userPayload)
  })
  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  // ── /heatmap/data ─────────────────────────────────────────────────────────

  it('HM-BIZ-001 POST /heatmap/data 默认参数 → 201', async () => {
    mockHeatmapService.getHeatmap.mockResolvedValueOnce(sampleHeatmapItems)
    const res = await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({})
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toEqual(sampleHeatmapItems)
  })

  it('HM-BIZ-002 POST /heatmap/data 指定 trade_date → 201', async () => {
    mockHeatmapService.getHeatmap.mockResolvedValueOnce(sampleHeatmapItems)
    const res = await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ trade_date: '20260404' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(mockHeatmapService.getHeatmap).toHaveBeenCalledWith(
      expect.objectContaining({ trade_date: '20260404' }),
    )
  })

  it('HM-BIZ-003 POST /heatmap/data group_by=index → 201', async () => {
    mockHeatmapService.getHeatmap.mockResolvedValueOnce(sampleHeatmapItems)
    const res = await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ group_by: 'index', index_code: '000300.SH' })
      .expect(201)
    expect(res.body.code).toBe(0)
  })

  it('HM-BIZ-004 POST /heatmap/data group_by=concept → 201', async () => {
    mockHeatmapService.getHeatmap.mockResolvedValueOnce([])
    const res = await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ group_by: 'concept' })
      .expect(201)
    expect(res.body.code).toBe(0)
  })

  it('HM-BIZ-005 POST /heatmap/data industry_source=sw_l1 → 201', async () => {
    mockHeatmapService.getHeatmap.mockResolvedValueOnce(sampleHeatmapItems)
    const res = await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ industry_source: 'sw_l1' })
      .expect(201)
    expect(res.body.code).toBe(0)
  })

  it('HM-BIZ-006 POST /heatmap/data include_mapping=true → 201', async () => {
    const itemsWithMapping = [{
      ...sampleHeatmapItems[0],
      swCode: '801120.SI',
      swName: '食品饮料',
      dcTsCode: 'BK0438.DC',
      dcBoardCode: 'BK0438',
      dcName: '食品饮料',
    }]
    mockHeatmapService.getHeatmap.mockResolvedValueOnce(itemsWithMapping)
    const res = await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ industry_source: 'sw_l1', include_mapping: true })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data[0].swCode).toBe('801120.SI')
  })

  it('HM-BIZ-007 POST /heatmap/data limit 截断 → 201', async () => {
    mockHeatmapService.getHeatmap.mockResolvedValueOnce([sampleHeatmapItems[0]])
    const res = await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ limit: 1 })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data).toHaveLength(1)
  })

  // ── /heatmap/snapshot/history ──────────────────────────────────────────────

  it('HM-BIZ-010 POST /heatmap/snapshot/history 查询历史快照 → 201', async () => {
    mockSnapshotService.queryHistory.mockResolvedValueOnce(sampleHistoryResponse)
    const res = await request(app.getHttpServer())
      .post('/heatmap/snapshot/history')
      .send({ trade_date: '20260404' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.tradeDate).toBe('20260404')
    expect(res.body.data.isFromSnapshot).toBe(true)
  })

  it('HM-BIZ-011 POST /heatmap/snapshot/history 指定 group_by=000300.SH → 201', async () => {
    mockSnapshotService.queryHistory.mockResolvedValueOnce({
      ...sampleHistoryResponse,
      groupBy: '000300.SH',
    })
    const res = await request(app.getHttpServer())
      .post('/heatmap/snapshot/history')
      .send({ trade_date: '20260404', group_by: '000300.SH' })
      .expect(201)
    expect(res.body.code).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// [ERR] DTO 校验错误
// ═══════════════════════════════════════════════════════════════════════════════

describe('HeatmapController [ERR] DTO 校验', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await buildHeatmapApp(userPayload)
  })
  afterAll(() => app.close())

  it('HM-ERR-001 POST /heatmap/data trade_date 格式错误 → 400', async () => {
    await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ trade_date: '2026-04-04' })
      .expect(400)
  })

  it('HM-ERR-002 POST /heatmap/data group_by 非法值 → 400', async () => {
    await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ group_by: 'invalid' })
      .expect(400)
  })

  it('HM-ERR-003 POST /heatmap/data industry_source 非法值 → 400', async () => {
    await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ industry_source: 'invalid' })
      .expect(400)
  })

  it('HM-ERR-004 POST /heatmap/data limit 超出最大值 → 400', async () => {
    await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ limit: 5001 })
      .expect(400)
  })

  it('HM-ERR-005 POST /heatmap/data limit 小于最小值 → 400', async () => {
    await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ limit: 0 })
      .expect(400)
  })

  it('HM-ERR-007 POST /heatmap/snapshot/history trade_date 缺失 → 400', async () => {
    await request(app.getHttpServer())
      .post('/heatmap/snapshot/history')
      .send({})
      .expect(400)
  })

  it('HM-ERR-008 POST /heatmap/snapshot/history trade_date 格式错误 → 400', async () => {
    await request(app.getHttpServer())
      .post('/heatmap/snapshot/history')
      .send({ trade_date: '2026-04-04' })
      .expect(400)
  })

  it('HM-ERR-009 POST /heatmap/snapshot/history group_by 非法值 → 400', async () => {
    await request(app.getHttpServer())
      .post('/heatmap/snapshot/history')
      .send({ trade_date: '20260404', group_by: 'invalid' })
      .expect(400)
  })
})

describe('HeatmapController [ERR] snapshot/trigger DTO 校验 (SUPER_ADMIN)', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await buildHeatmapApp(superAdminPayload)
  })
  afterAll(() => app.close())

  it('HM-ERR-006 POST /heatmap/snapshot/trigger trade_date 格式错误 → 400', async () => {
    await request(app.getHttpServer())
      .post('/heatmap/snapshot/trigger')
      .send({ trade_date: '2026-04-04' })
      .expect(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// [ERR] 服务异常透传
// ═══════════════════════════════════════════════════════════════════════════════

describe('HeatmapController [ERR] 服务异常', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await buildHeatmapApp(userPayload)
  })
  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  it('HM-ERR-010 POST /heatmap/data service 抛 NotFoundException → 404', async () => {
    mockHeatmapService.getHeatmap.mockRejectedValueOnce(new NotFoundException('暂无日线行情数据'))
    const res = await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({})
      .expect(404)
    expect(res.body.code).not.toBe(0)
  })

  it('HM-ERR-011 POST /heatmap/snapshot/history service 抛 NotFoundException → 404', async () => {
    mockSnapshotService.queryHistory.mockRejectedValueOnce(new NotFoundException('暂无数据'))
    const res = await request(app.getHttpServer())
      .post('/heatmap/snapshot/history')
      .send({ trade_date: '20260404' })
      .expect(404)
    expect(res.body.code).not.toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// [EDGE] 边界值
// ═══════════════════════════════════════════════════════════════════════════════

describe('HeatmapController [EDGE]', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await buildHeatmapApp(userPayload)
  })
  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  it('HM-EDGE-001 POST /heatmap/data limit=1（最小值） → 201', async () => {
    mockHeatmapService.getHeatmap.mockResolvedValueOnce([sampleHeatmapItems[0]])
    const res = await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ limit: 1 })
      .expect(201)
    expect(res.body.code).toBe(0)
  })

  it('HM-EDGE-002 POST /heatmap/data limit=5000（最大值） → 201', async () => {
    mockHeatmapService.getHeatmap.mockResolvedValueOnce(sampleHeatmapItems)
    const res = await request(app.getHttpServer())
      .post('/heatmap/data')
      .send({ limit: 5000 })
      .expect(201)
    expect(res.body.code).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// [SEC] 安全：权限边界
// ═══════════════════════════════════════════════════════════════════════════════

describe('HeatmapController [SEC] 权限边界', () => {
  it('HM-SEC-001 USER 角色 POST /heatmap/snapshot/trigger → 403', async () => {
    const app = await buildHeatmapApp(userPayload)
    try {
      await request(app.getHttpServer())
        .post('/heatmap/snapshot/trigger')
        .send({})
        .expect(403)
    } finally {
      await app.close()
    }
  })

  it('HM-SEC-002 ADMIN 角色 POST /heatmap/snapshot/trigger → 403（需 SUPER_ADMIN）', async () => {
    const app = await buildHeatmapApp(adminPayload)
    try {
      await request(app.getHttpServer())
        .post('/heatmap/snapshot/trigger')
        .send({})
        .expect(403)
    } finally {
      await app.close()
    }
  })

  it('HM-SEC-003 未登录 POST /heatmap/snapshot/trigger → 401', async () => {
    const app = await buildHeatmapApp(null)
    try {
      await request(app.getHttpServer())
        .post('/heatmap/snapshot/trigger')
        .send({})
        .expect(401)
    } finally {
      await app.close()
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// [BIZ] SUPER_ADMIN 触发快照
// ═══════════════════════════════════════════════════════════════════════════════

describe('HeatmapController [BIZ] SUPER_ADMIN 快照触发', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await buildHeatmapApp(superAdminPayload)
  })
  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  it('HM-BIZ-008 POST /heatmap/snapshot/trigger 默认参数 → 201', async () => {
    mockSnapshotService.aggregateSnapshot.mockResolvedValueOnce({
      tradeDate: '20260404',
      totalRecords: 5000,
    })
    const res = await request(app.getHttpServer())
      .post('/heatmap/snapshot/trigger')
      .send({})
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(res.body.data.tradeDate).toBe('20260404')
    expect(res.body.data.totalRecords).toBe(5000)
  })

  it('HM-BIZ-009 POST /heatmap/snapshot/trigger 指定 trade_date → 201', async () => {
    mockSnapshotService.aggregateSnapshot.mockResolvedValueOnce({
      tradeDate: '20260401',
      totalRecords: 4800,
    })
    const res = await request(app.getHttpServer())
      .post('/heatmap/snapshot/trigger')
      .send({ trade_date: '20260401' })
      .expect(201)
    expect(res.body.code).toBe(0)
    expect(mockSnapshotService.aggregateSnapshot).toHaveBeenCalledWith('20260401')
  })
})
