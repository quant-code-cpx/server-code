import { Test, TestingModule } from '@nestjs/testing'
import { Job } from 'bullmq'
import { BacktestingProcessor } from '../backtesting.processor'
import { EventsGateway } from 'src/websocket/events.gateway'
import { BacktestEngineService } from 'src/apps/backtest/services/backtest-engine.service'
import { BacktestRunService } from 'src/apps/backtest/services/backtest-run.service'
import { BacktestReportService } from 'src/apps/backtest/services/backtest-report.service'
import { BacktestWalkForwardService } from 'src/apps/backtest/services/backtest-walk-forward.service'
import { BacktestComparisonService } from 'src/apps/backtest/services/backtest-comparison.service'
import { PrismaService } from 'src/shared/prisma.service'
import { BacktestingJobName } from 'src/constant/queue.constant'
import { createMockPrismaService } from 'test/helpers/prisma-mock'

// ── Job 工厂 ──────────────────────────────────────────────────────────────────

function makeJob<T>(name: string, data: T, id = 'job-1'): jest.Mocked<Job<T>> {
  return {
    id,
    name,
    data,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Job<T>>
}

describe('BacktestingProcessor', () => {
  let processor: BacktestingProcessor
  let eventsGateway: jest.Mocked<EventsGateway>
  let engineService: jest.Mocked<BacktestEngineService>
  let runService: jest.Mocked<BacktestRunService>
  let reportService: jest.Mocked<BacktestReportService>
  let walkForwardService: jest.Mocked<BacktestWalkForwardService>
  let comparisonService: jest.Mocked<BacktestComparisonService>
  let prisma: ReturnType<typeof createMockPrismaService>

  beforeEach(async () => {
    eventsGateway = {
      emitBacktestProgress: jest.fn(),
      emitBacktestCompleted: jest.fn(),
      emitBacktestFailed: jest.fn(),
    } as unknown as jest.Mocked<EventsGateway>

    engineService = {
      runBacktest: jest.fn().mockResolvedValue({ equity: [] }),
    } as unknown as jest.Mocked<BacktestEngineService>

    runService = {
      loadConfig: jest.fn().mockResolvedValue({ strategyType: 'MA_CROSS_SINGLE', strategyConfig: {} }),
    } as unknown as jest.Mocked<BacktestRunService>

    reportService = {
      saveReport: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<BacktestReportService>

    walkForwardService = {
      runWalkForward: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<BacktestWalkForwardService>

    comparisonService = {
      runComparison: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<BacktestComparisonService>

    prisma = createMockPrismaService()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestingProcessor,
        { provide: EventsGateway, useValue: eventsGateway },
        { provide: BacktestEngineService, useValue: engineService },
        { provide: BacktestRunService, useValue: runService },
        { provide: BacktestReportService, useValue: reportService },
        { provide: BacktestWalkForwardService, useValue: walkForwardService },
        { provide: BacktestComparisonService, useValue: comparisonService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    processor = module.get(BacktestingProcessor)
  })

  afterEach(() => jest.clearAllMocks())

  // ── run-backtest ───────────────────────────────────────────────────────────

  it('process(run-backtest) — 成功：更新状态、调用引擎、保存报告、emit 进度+完成', async () => {
    prisma.backtestRun.update.mockResolvedValue({} as never)
    const job = makeJob(BacktestingJobName.RUN_BACKTEST, { runId: 'run-1', userId: 1 })

    const result = await processor.process(job)

    expect(prisma.backtestRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run-1' }, data: expect.objectContaining({ status: 'RUNNING' }) }),
    )
    expect(engineService.runBacktest).toHaveBeenCalled()
    expect(reportService.saveReport).toHaveBeenCalledWith('run-1', expect.anything())
    expect(eventsGateway.emitBacktestProgress).toHaveBeenCalled()
    expect(eventsGateway.emitBacktestCompleted).toHaveBeenCalledWith('job-1', expect.objectContaining({ runId: 'run-1' }))
    expect(result).toMatchObject({ runId: 'run-1' })
    expect(result.completedAt).toBeDefined()
  })

  it('process(run-backtest) — 引擎抛出 → 异常向上冒泡', async () => {
    prisma.backtestRun.update.mockResolvedValue({} as never)
    engineService.runBacktest.mockRejectedValue(new Error('engine crash'))
    const job = makeJob(BacktestingJobName.RUN_BACKTEST, { runId: 'run-2', userId: 1 })

    await expect(processor.process(job)).rejects.toThrow('engine crash')
    expect(reportService.saveReport).not.toHaveBeenCalled()
    expect(eventsGateway.emitBacktestCompleted).not.toHaveBeenCalled()
  })

  it('process(run-backtest) — 进度回调调用 updateProgress', async () => {
    prisma.backtestRun.update.mockResolvedValue({} as never)
    // 让引擎模拟进度回调
    engineService.runBacktest.mockImplementation(async (_config, onProgress) => {
      if (onProgress) await onProgress(25, 'computing')
      return { navRecords: [], trades: [], positions: [], rebalanceLogs: [], metrics: {} } as never
    })
    const job = makeJob(BacktestingJobName.RUN_BACKTEST, { runId: 'run-3', userId: 1 })

    await processor.process(job)
    expect(job.updateProgress).toHaveBeenCalledWith(25)
    expect(eventsGateway.emitBacktestProgress).toHaveBeenCalledWith('job-1', 25, 'computing')
  })

  // ── run-walk-forward ───────────────────────────────────────────────────────

  it('process(run-walk-forward) — 成功：调用 walkForwardService，emit 完成', async () => {
    const job = makeJob(BacktestingJobName.RUN_WALK_FORWARD, { wfRunId: 'wf-1', userId: 1 })

    const result = await processor.process(job)

    expect(walkForwardService.runWalkForward).toHaveBeenCalledWith('wf-1', expect.any(Function))
    expect(eventsGateway.emitBacktestCompleted).toHaveBeenCalledWith('job-1', expect.objectContaining({ runId: 'wf-1' }))
    expect(result.runId).toBe('wf-1')
  })

  it('process(run-walk-forward) — 失败：更新 walkForward 状态为 FAILED，重新抛出', async () => {
    walkForwardService.runWalkForward.mockRejectedValue(new Error('wf error'))
    prisma.backtestWalkForwardRun.update.mockResolvedValue({} as never)
    const job = makeJob(BacktestingJobName.RUN_WALK_FORWARD, { wfRunId: 'wf-2', userId: 1 })

    await expect(processor.process(job)).rejects.toThrow('wf error')
    expect(prisma.backtestWalkForwardRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )
  })

  // ── run-comparison ─────────────────────────────────────────────────────────

  it('process(run-comparison) — 成功：调用 comparisonService，emit 完成', async () => {
    const job = makeJob(BacktestingJobName.RUN_COMPARISON, { groupId: 'grp-1', userId: 1 })

    const result = await processor.process(job)

    expect(comparisonService.runComparison).toHaveBeenCalledWith('grp-1', expect.any(Function))
    expect(eventsGateway.emitBacktestCompleted).toHaveBeenCalledWith('job-1', expect.objectContaining({ runId: 'grp-1' }))
    expect(result.runId).toBe('grp-1')
  })

  it('process(run-comparison) — 失败：更新 comparisonGroup 状态为 FAILED，重新抛出', async () => {
    comparisonService.runComparison.mockRejectedValue(new Error('cmp error'))
    prisma.backtestComparisonGroup.update.mockResolvedValue({} as never)
    const job = makeJob(BacktestingJobName.RUN_COMPARISON, { groupId: 'grp-2', userId: 1 })

    await expect(processor.process(job)).rejects.toThrow('cmp error')
    expect(prisma.backtestComparisonGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'FAILED' } }),
    )
  })

  // ── 未知 job ──────────────────────────────────────────────────────────────

  it('process(unknown-job) — 抛出 BusinessException', async () => {
    const job = makeJob('unknown-job-name', {} as never)
    await expect(processor.process(job)).rejects.toThrow()
  })

  // ── onFailed 事件 ─────────────────────────────────────────────────────────

  it('onFailed — emit backtest_failed，尝试更新 run 状态为 FAILED', async () => {
    prisma.backtestRun.update.mockResolvedValue({} as never)
    const job = makeJob(BacktestingJobName.RUN_BACKTEST, { runId: 'run-fail', userId: 1 })
    const error = new Error('job failed reason')

    await processor.onFailed(job, error)

    expect(eventsGateway.emitBacktestFailed).toHaveBeenCalledWith('job-1', 'job failed reason')
    expect(prisma.backtestRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', failedReason: 'job failed reason' }) }),
    )
  })

  it('onFailed — 无 runId 也不崩溃', async () => {
    const job = makeJob('run-walk-forward', { wfRunId: 'wf-x', userId: 1 })
    const error = new Error('no runId')
    await expect(processor.onFailed(job, error)).resolves.not.toThrow()
    expect(eventsGateway.emitBacktestFailed).toHaveBeenCalledWith('job-1', 'no runId')
  })
})
