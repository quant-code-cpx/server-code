import { BacktestAnalyticsToolError, BacktestAnalyticsToolFacade } from '../backtest-analytics-tool.facade'

function harness() {
  const repository = {
    findOwnedRun: jest.fn(),
    ownsParamSweep: jest.fn(async () => true),
    ownsWalkForward: jest.fn(async () => true),
    ownsComparison: jest.fn(async () => true),
  }
  const readPort = {
    monteCarlo: jest.fn(),
    brinson: jest.fn(),
    costSensitivity: jest.fn(),
    getParamSweepResult: jest.fn(),
    getWalkForwardResult: jest.fn(),
    getComparisonResult: jest.fn(),
  }
  const facade = new BacktestAnalyticsToolFacade(repository as never, readPort as never)
  return { facade, repository, readPort }
}

const completedRun = {
  id: 'run-1',
  status: 'COMPLETED',
  reproducibilityStatus: 'VERIFIED',
  engineVersion: 'engine-v1',
  dataContractVersion: 'data-v1',
  universePolicyVersion: 'universe-v1',
  financialAsOfPolicyVersion: 'financial-v1',
  adjustmentPolicyVersion: 'adjustment-v1',
  qualityFlags: [],
  completedAt: new Date('2026-08-01T08:00:00.000Z'),
}

describe('BacktestAnalyticsToolFacade', () => {
  it('[BIZ] 多分析 fail-soft，Monte Carlo 路径确定性限界且保留可复现元数据', async () => {
    const { facade, repository, readPort } = harness()
    repository.findOwnedRun.mockResolvedValue(completedRun)
    readPort.monteCarlo.mockResolvedValue({
      seed: 42,
      timeSeries: Array.from({ length: 101 }, (_, index) => ({ index, nav: 1 + index / 100 })),
    })
    readPort.costSensitivity.mockRejectedValue(new Error('raw database detail'))

    const result = await facade.analyze(7, {
      analyses: ['MONTE_CARLO', 'COST_SENSITIVITY'],
      backtestRunId: 'run-1',
      monteCarlo: { simulations: 100, seed: 42, maxSeriesPoints: 20 },
    })

    expect(readPort.monteCarlo).toHaveBeenCalledWith(
      'run-1',
      7,
      expect.objectContaining({ simulations: 100, seed: 42 }),
    )
    expect(result.data.monteCarlo).toMatchObject({ status: 'OK', data: { seed: 42, timeSeriesTruncated: true } })
    expect((result.data.monteCarlo.data as { timeSeries: unknown[] }).timeSeries).toHaveLength(20)
    expect(result.data.costSensitivity).toEqual({
      status: 'ERROR',
      data: null,
      error: { code: 'UPSTREAM_FAILED', message: '该回测分析暂时不可用' },
    })
    expect(result.data.partial).toBe(true)
    expect(result.data.reproducibility).toMatchObject({ verified: true, engineVersion: 'engine-v1' })
  })

  it('[SEC] owner scoped 查询失败时不调用任何分析端口', async () => {
    const { facade, repository, readPort } = harness()
    repository.findOwnedRun.mockResolvedValue(null)

    await expect(
      facade.analyze(99, {
        analyses: ['MONTE_CARLO'],
        backtestRunId: 'other-user-run',
        monteCarlo: { simulations: 100, seed: 1 },
      }),
    ).rejects.toMatchObject({ code: 'DATA_NOT_FOUND' })
    expect(readPort.monteCarlo).not.toHaveBeenCalled()
  })

  it('[BIZ] 读取已持久化高级结果，不触发 create/enqueue', async () => {
    const { facade, repository, readPort } = harness()
    readPort.getParamSweepResult.mockResolvedValue({ id: 'sweep-1', status: 'COMPLETED', items: [{ score: 1 }] })

    const result = await facade.analyze(7, { analyses: ['PARAM_SWEEP_RESULT'], paramSweepId: 'sweep-1' })

    expect(repository.ownsParamSweep).toHaveBeenCalledWith('sweep-1', 7)
    expect(readPort.getParamSweepResult).toHaveBeenCalledWith('sweep-1', 7)
    expect(result.data.paramSweepResult.status).toBe('OK')
    expect(result.data.backtestRunId).toBeNull()
  })

  it('[EDGE] 全部 section 失败时返回可重试的整体错误', async () => {
    const { facade, repository, readPort } = harness()
    repository.findOwnedRun.mockResolvedValue(completedRun)
    readPort.brinson.mockRejectedValue(new Error('fail'))

    await expect(facade.analyze(7, { analyses: ['BRINSON_ATTRIBUTION'], backtestRunId: 'run-1' })).rejects.toEqual(
      expect.objectContaining<Partial<BacktestAnalyticsToolError>>({ code: 'UPSTREAM_FAILED', retryable: true }),
    )
  })

  it('[VALIDATION] Monte Carlo 必须有显式 seed，成本网格最多 25 项', async () => {
    const { facade } = harness()
    await expect(
      facade.analyze(7, {
        analyses: ['MONTE_CARLO'],
        backtestRunId: 'run-1',
        monteCarlo: { simulations: 100, seed: Number.NaN },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      facade.analyze(7, {
        analyses: ['COST_SENSITIVITY'],
        backtestRunId: 'run-1',
        costSensitivity: {
          commissionRates: [0, 0.001, 0.002, 0.003, 0.004],
          slippageBps: [0, 1, 2, 3, 4, 5] as never,
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})
