import { Test } from '@nestjs/testing'
import { AgentToolsConfig } from 'src/config/agent-tools.config'
import { PrismaService } from 'src/shared/prisma.service'
import { FinancialToolInvalidArgumentError } from '../financial-tool.facade'
import { MoneyflowToolFacade } from '../moneyflow-tool.facade'

const config = {
  enabledTools: [],
  maxCallsPerRun: 20,
  defaultTimeoutMs: 10_000,
  maxResultBytes: 256_000,
  maxConcurrentPerRun: 3,
  priceMaxBars: 5_000,
  marketCacheTtlSeconds: 300,
  financialMaxPeriods: 20,
  moneyflowMaxDays: 250,
}

function moneyflowRow(tradeDate: string, overrides: Record<string, unknown> = {}) {
  return {
    tradeDate: new Date(`${tradeDate}T00:00:00.000Z`),
    buySmVol: 10,
    buySmAmount: 10,
    sellSmVol: 5,
    sellSmAmount: 5,
    buyMdVol: 20,
    buyMdAmount: 20,
    sellMdVol: 10,
    sellMdAmount: 10,
    buyLgVol: 30,
    buyLgAmount: 30,
    sellLgVol: 15,
    sellLgAmount: 15,
    buyElgVol: 40,
    buyElgAmount: 40,
    sellElgVol: 20,
    sellElgAmount: 20,
    netMfVol: 777,
    netMfAmount: 999,
    ...overrides,
  }
}

async function harness() {
  const prisma = { moneyflow: { findMany: jest.fn() } }
  const module = await Test.createTestingModule({
    providers: [
      MoneyflowToolFacade,
      { provide: PrismaService, useValue: prisma },
      { provide: AgentToolsConfig.KEY, useValue: config },
    ],
  }).compile()
  return { facade: module.get(MoneyflowToolFacade), prisma }
}

describe('MoneyflowToolFacade', () => {
  it('[FMT-DATA-004] 保留官方 net_mf_amount，不用分单买卖差额重算', async () => {
    const { facade, prisma } = await harness()
    prisma.moneyflow.findMany.mockResolvedValue([moneyflowRow('2024-01-02')])

    const result = await facade.getDaily({
      tsCode: '600519.SH',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      includeOrderBuckets: true,
      limit: 60,
    })

    expect(result.data.days[0].netAmount).toBe(999)
    expect(result.data.days[0].orderBuckets.extraLarge.netAmount).toBe(20)
    expect(result.data.units).toEqual({ amount: 'CNY_10K', volume: 'LOT', netSign: 'POSITIVE_INFLOW' })
  })

  it('[FMT-BIZ-005/DATA-005] 不请求分单时省略 buckets，官方 null 保持 null', async () => {
    const { facade, prisma } = await harness()
    prisma.moneyflow.findMany.mockResolvedValue([moneyflowRow('2024-01-02', { netMfVol: null, netMfAmount: null })])

    const result = await facade.getDaily({
      tsCode: '600519.SH',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      includeOrderBuckets: false,
      limit: 60,
    })

    expect(result.data.days[0]).toEqual({ tradeDate: '2024-01-02', netAmount: null, netVolume: null })
  })

  it('[FMT-EDGE-007] limit+1 判定截断，输出按交易日升序且日期范围下推', async () => {
    const { facade, prisma } = await harness()
    prisma.moneyflow.findMany.mockResolvedValue([
      moneyflowRow('2024-01-03'),
      moneyflowRow('2024-01-02'),
      moneyflowRow('2024-01-01'),
    ])

    const result = await facade.getDaily({
      tsCode: '600519.SH',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      includeOrderBuckets: false,
      limit: 2,
    })

    expect(result.truncated).toBe(true)
    expect(result.data.days.map((day) => day.tradeDate)).toEqual(['2024-01-02', '2024-01-03'])
    expect(prisma.moneyflow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tsCode: '600519.SH',
          tradeDate: { gte: new Date('2024-01-01T00:00:00.000Z'), lte: new Date('2024-01-31T00:00:00.000Z') },
        },
        take: 3,
      }),
    )
  })

  it('[FMT-ERR-001/SEC-002] 反向日期与超服务端上限在 Prisma 前拒绝', async () => {
    const { facade, prisma } = await harness()

    await expect(
      facade.getDaily({
        tsCode: '600519.SH',
        startDate: '2024-02-01',
        endDate: '2024-01-01',
        includeOrderBuckets: true,
        limit: 60,
      }),
    ).rejects.toBeInstanceOf(FinancialToolInvalidArgumentError)
    await expect(
      facade.getDaily({
        tsCode: '600519.SH',
        startDate: '2024-01-01',
        endDate: '2024-02-01',
        includeOrderBuckets: true,
        limit: 251,
      }),
    ).rejects.toBeInstanceOf(FinancialToolInvalidArgumentError)
    expect(prisma.moneyflow.findMany).not.toHaveBeenCalled()
  })
})
