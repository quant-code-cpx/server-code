/**
 * BacktestPortfolioBridgeService — 单元测试
 *
 * 覆盖场景：
 * 1. 回测不存在 → NotFoundException
 * 2. 回测非当前用户 → ForbiddenException
 * 3. 回测未完成 → BadRequestException
 * 4. 回测无持仓快照 → BadRequestException
 * 5. REPLACE 模式 — 目标组合有原持仓 → 清空 + 写入 + 返回 SELL + BUY
 * 6. REPLACE 模式 — 新建组合（不传 portfolioId）→ 创建组合 + 写入 + 全部 BUY
 * 7. MERGE 模式 — 部分标的重叠 → 重叠=ADJUST，非重叠=BUY，原有=HOLD
 * 8. 回测持仓 stockName 查不到时用 tsCode 兜底
 * 9. 目标组合不属于当前用户 → ForbiddenException
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { BacktestPortfolioBridgeService } from '../services/backtest-portfolio-bridge.service'
import { ApplyMode } from '../dto/apply-backtest.dto'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    backtestRun: {
      findUnique: jest.fn(),
    },
    backtestPositionSnapshot: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    portfolio: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    portfolioHolding: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    stockBasic: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  }
}

function buildCacheServiceMock() {
  return {
    invalidateByPrefixes: jest.fn(async () => undefined),
  }
}

function buildService(
  prismaMock: ReturnType<typeof buildPrismaMock>,
  cacheMock: ReturnType<typeof buildCacheServiceMock>,
) {
  const tradeLogMock = { log: jest.fn(async () => {}) }
  return new BacktestPortfolioBridgeService(prismaMock as any, cacheMock as any, tradeLogMock as any)
}

// ── 共用夹具 ──────────────────────────────────────────────────────────────────

const SNAPSHOT_DATE = new Date('2024-12-31')

function makeRun(overrides: Partial<{ userId: number; status: string; name: string }> = {}) {
  return {
    id: 'run-1',
    userId: 1,
    status: 'COMPLETED',
    name: '价值策略',
    initialCapital: new Decimal(100000),
    ...overrides,
  }
}

function makeSnapshot(tsCode: string, quantity: number, costPrice: number) {
  return {
    runId: 'run-1',
    tradeDate: SNAPSHOT_DATE,
    tsCode,
    quantity,
    costPrice: new Decimal(costPrice),
  }
}

function makeHolding(id: string, tsCode: string, quantity: number, avgCost: number, stockName = '名称') {
  return { id, portfolioId: 'p-1', tsCode, quantity, avgCost: new Decimal(avgCost), stockName, createdAt: new Date() }
}

// ── 测试 ─────────────────────────────────────────────────────────────────────

describe('BacktestPortfolioBridgeService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>
  let cache: ReturnType<typeof buildCacheServiceMock>
  let svc: BacktestPortfolioBridgeService

  beforeEach(() => {
    prisma = buildPrismaMock()
    cache = buildCacheServiceMock()
    svc = buildService(prisma, cache)
  })

  // ── 1. 回测不存在 ──────────────────────────────────────────────────────────
  it('回测不存在 → NotFoundException', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(null)
    await expect(svc.applyBacktest({ backtestRunId: 'run-x', portfolioId: 'p-1' }, 1)).rejects.toThrow(
      NotFoundException,
    )
  })

  // ── 2. 回测非当前用户 ──────────────────────────────────────────────────────
  it('回测非当前用户 → ForbiddenException', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun({ userId: 99 }))
    await expect(svc.applyBacktest({ backtestRunId: 'run-1', portfolioId: 'p-1' }, 1)).rejects.toThrow(
      ForbiddenException,
    )
  })

  // ── 3. 回测未完成 ──────────────────────────────────────────────────────────
  it('回测未完成 → BadRequestException', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun({ status: 'RUNNING' }))
    await expect(svc.applyBacktest({ backtestRunId: 'run-1', portfolioId: 'p-1' }, 1)).rejects.toThrow(
      BadRequestException,
    )
  })

  // ── 4. 回测无持仓快照 ──────────────────────────────────────────────────────
  it('回测无持仓快照 → BadRequestException', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun())
    prisma.backtestPositionSnapshot.findFirst.mockResolvedValue(null)
    await expect(svc.applyBacktest({ backtestRunId: 'run-1', portfolioId: 'p-1' }, 1)).rejects.toThrow(
      BadRequestException,
    )
  })

  // ── 5. REPLACE 模式 — 目标组合有原持仓 ────────────────────────────────────
  it('REPLACE 模式: 清空原持仓, 写入回测持仓, 返回 SELL + BUY', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun())
    prisma.backtestPositionSnapshot.findFirst.mockResolvedValue({ tradeDate: SNAPSHOT_DATE })
    prisma.backtestPositionSnapshot.findMany.mockResolvedValue([makeSnapshot('000001.SZ', 1000, 12.5)])
    prisma.portfolio.findUnique.mockResolvedValue({ id: 'p-1', userId: 1, name: '我的组合' })
    prisma.portfolioHolding.findMany.mockResolvedValue([makeHolding('h-1', '600519.SH', 100, 1800, '贵州茅台')])
    prisma.stockBasic.findMany.mockResolvedValue([{ tsCode: '000001.SZ', name: '平安银行' }])
    prisma.$transaction.mockResolvedValue([undefined, { count: 1 }])

    const result = await svc.applyBacktest({ backtestRunId: 'run-1', portfolioId: 'p-1', mode: ApplyMode.REPLACE }, 1)

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(result.mode).toBe(ApplyMode.REPLACE)
    expect(result.summary.added).toBe(1)
    expect(result.summary.removed).toBe(1)

    const sell = result.changes.find((c) => c.action === 'SELL')
    expect(sell?.tsCode).toBe('600519.SH')

    const buy = result.changes.find((c) => c.action === 'BUY')
    expect(buy?.tsCode).toBe('000001.SZ')
    expect(buy?.stockName).toBe('平安银行')
  })

  // ── 6. REPLACE 模式 — 新建组合 ────────────────────────────────────────────
  it('REPLACE 模式: 不传 portfolioId → 自动创建组合, 全部 BUY', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun())
    prisma.backtestPositionSnapshot.findFirst.mockResolvedValue({ tradeDate: SNAPSHOT_DATE })
    prisma.backtestPositionSnapshot.findMany.mockResolvedValue([
      makeSnapshot('000002.SZ', 500, 20),
      makeSnapshot('600036.SH', 200, 50),
    ])
    prisma.portfolio.create.mockResolvedValue({ id: 'p-new', name: '回测导入-价值策略' })
    prisma.portfolioHolding.findMany.mockResolvedValue([])
    prisma.stockBasic.findMany.mockResolvedValue([])
    prisma.$transaction.mockResolvedValue([undefined, { count: 2 }])

    const result = await svc.applyBacktest({ backtestRunId: 'run-1' }, 1)

    expect(prisma.portfolio.create).toHaveBeenCalledTimes(1)
    expect(result.portfolioId).toBe('p-new')
    expect(result.summary.added).toBe(2)
    expect(result.summary.removed).toBe(0)
    expect(result.changes.every((c) => c.action === 'BUY')).toBe(true)
  })

  // ── 7. MERGE 模式 — 部分标的重叠 ──────────────────────────────────────────
  it('MERGE 模式: 重叠=ADJUST, 非重叠=BUY, 原有=HOLD', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun())
    prisma.backtestPositionSnapshot.findFirst.mockResolvedValue({ tradeDate: SNAPSHOT_DATE })
    // 回测: 001 (已有 → ADJUST), 002 (无 → BUY)
    prisma.backtestPositionSnapshot.findMany.mockResolvedValue([
      makeSnapshot('000001.SZ', 500, 10),
      makeSnapshot('000002.SZ', 300, 20),
    ])
    prisma.portfolio.findUnique.mockResolvedValue({ id: 'p-1', userId: 1, name: '我的组合' })
    // 组合现有: 001 (重叠), 003 (不在回测 → HOLD)
    prisma.portfolioHolding.findMany.mockResolvedValue([
      makeHolding('h-1', '000001.SZ', 200, 8, '平安银行'),
      makeHolding('h-2', '000003.SZ', 100, 15, '国农科技'),
    ])
    prisma.stockBasic.findMany.mockResolvedValue([
      { tsCode: '000001.SZ', name: '平安银行' },
      { tsCode: '000002.SZ', name: '万科A' },
    ])
    prisma.$transaction.mockResolvedValue([undefined, undefined])

    const result = await svc.applyBacktest({ backtestRunId: 'run-1', portfolioId: 'p-1', mode: ApplyMode.MERGE }, 1)

    expect(result.mode).toBe(ApplyMode.MERGE)
    expect(result.summary.added).toBe(1) // 000002 新增
    expect(result.summary.updated).toBe(1) // 000001 合并
    expect(result.summary.unchanged).toBe(1) // 000003 不动

    const adjust = result.changes.find((c) => c.tsCode === '000001.SZ')
    expect(adjust?.action).toBe('ADJUST')
    expect(adjust?.targetQuantity).toBe(700) // 200 + 500
    // 加权平均: (200*8 + 500*10) / 700 ≈ 9.428
    expect(adjust?.targetAvgCost).toBeCloseTo(9.428, 2)

    const buy = result.changes.find((c) => c.tsCode === '000002.SZ')
    expect(buy?.action).toBe('BUY')

    const hold = result.changes.find((c) => c.tsCode === '000003.SZ')
    expect(hold?.action).toBe('HOLD')
    expect(hold?.deltaQuantity).toBe(0)
  })

  // ── 8. stockName 兜底 ──────────────────────────────────────────────────────
  it('StockBasic 查不到时用 tsCode 作为 stockName', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun())
    prisma.backtestPositionSnapshot.findFirst.mockResolvedValue({ tradeDate: SNAPSHOT_DATE })
    prisma.backtestPositionSnapshot.findMany.mockResolvedValue([makeSnapshot('UNKNOWN.HK', 100, 5)])
    prisma.portfolio.findUnique.mockResolvedValue({ id: 'p-1', userId: 1, name: '组合' })
    prisma.portfolioHolding.findMany.mockResolvedValue([])
    prisma.stockBasic.findMany.mockResolvedValue([]) // 查不到
    prisma.$transaction.mockResolvedValue([undefined, { count: 1 }])

    const result = await svc.applyBacktest({ backtestRunId: 'run-1', portfolioId: 'p-1' }, 1)

    const change = result.changes[0]
    expect(change.stockName).toBe('UNKNOWN.HK')
  })

  // ── 9. 目标组合不属于当前用户 ──────────────────────────────────────────────
  it('目标组合不属于当前用户 → ForbiddenException', async () => {
    prisma.backtestRun.findUnique.mockResolvedValue(makeRun())
    prisma.backtestPositionSnapshot.findFirst.mockResolvedValue({ tradeDate: SNAPSHOT_DATE })
    prisma.backtestPositionSnapshot.findMany.mockResolvedValue([makeSnapshot('000001.SZ', 100, 10)])
    prisma.portfolio.findUnique.mockResolvedValue({ id: 'p-other', userId: 99, name: '别人的组合' })

    await expect(svc.applyBacktest({ backtestRunId: 'run-1', portfolioId: 'p-other' }, 1)).rejects.toThrow(
      ForbiddenException,
    )
  })
})
