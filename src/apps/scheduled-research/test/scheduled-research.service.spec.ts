import {
  AiModelPolicy,
  AiScheduledTaskStatus,
  AiScheduledTaskTrigger,
  AiTaskExecutionStatus,
  type AiScheduledTask,
  type AiTaskExecution,
} from '@prisma/client'
import { ScheduledResearchService } from '../scheduled-research.service'

describe('ScheduledResearchService scanner', () => {
  const now = new Date('2026-07-22T10:30:00.000Z')

  it('双 scanner 同一逻辑时点只创建一个 execution 和一个 Run', async () => {
    const task = createTask({ nextRunAt: now })
    let claimed = false
    const repository = baseRepository(task)
    repository.claimDue.mockImplementation(async () => {
      if (claimed) return false
      claimed = true
      return true
    })
    repository.findTaskById.mockResolvedValue({ ...task, leaseOwner: 'scanner-a' })
    repository.createExecutionOnce.mockResolvedValue({ execution: createExecution(task), created: true })
    const runs = { sendScheduled: jest.fn().mockResolvedValue({ runId: 'run_1' }) }
    const service = createService(repository, runs)

    await Promise.all([service.scanDue(now, 'scanner-a'), service.scanDue(now, 'scanner-b')])

    expect(repository.createExecutionOnce).toHaveBeenCalledTimes(1)
    expect(runs.sendScheduled).toHaveBeenCalledTimes(1)
    expect(repository.queueExecution).toHaveBeenCalledWith('execution_1', 'run_1', expect.any(Object))
  })

  it('条件满足但仍处于冷却窗口时不创建 execution', async () => {
    const task = createTask({
      trigger: AiScheduledTaskTrigger.STRUCTURED_CONDITION,
      condition: {
        metricKey: 'DAILY_CLOSE',
        resourceId: '600519.SH',
        operator: 'GT',
        threshold: 1500,
        cooldownMinutes: 60,
      },
      nextRunAt: now,
    })
    const repository = baseRepository(task)
    repository.findTaskById.mockResolvedValue({ ...task, leaseOwner: 'scanner-a' })
    repository.findDailyConditionValue.mockResolvedValue({
      tsCode: '600519.SH',
      tradeDate: new Date('2026-07-22T00:00:00.000Z'),
      close: 1600,
      syncedAt: now,
    })
    repository.findLatestTriggeredExecution.mockResolvedValue(
      createExecution(task, { queuedAt: new Date(now.getTime() - 30 * 60_000) }),
    )
    const service = createService(repository, { sendScheduled: jest.fn() })

    await service.scanDue(now, 'scanner-a')

    expect(repository.createExecutionOnce).not.toHaveBeenCalled()
    expect(repository.finishClaim).toHaveBeenCalledWith(
      expect.objectContaining({ nextRunAt: new Date(now.getTime() + 60_000) }),
    )
  })

  it('数据 watermark 未就绪时记录 DEFERRED，不将半同步数据送入 Agent', async () => {
    const task = createTask({
      nextRunAt: now,
      requiredWatermarks: [{ dataset: 'DAILY', minTradeDate: '20260722', maxAgeMinutes: 180 }],
    })
    const execution = createExecution(task)
    const repository = baseRepository(task)
    repository.findTaskById.mockResolvedValue({ ...task, leaseOwner: 'scanner-a' })
    repository.findDailyWatermark.mockResolvedValue(null)
    repository.createExecutionOnce.mockResolvedValue({ execution, created: true })
    const runs = { sendScheduled: jest.fn() }
    const service = createService(repository, runs)

    await service.scanDue(now, 'scanner-a')

    expect(repository.deferExecution).toHaveBeenCalledWith(
      'execution_1',
      expect.objectContaining({ reason: 'WATERMARK_MISSING' }),
    )
    expect(runs.sendScheduled).not.toHaveBeenCalled()
  })
})

function createService(repository: Record<string, jest.Mock>, runs: { sendScheduled: jest.Mock }) {
  return new ScheduledResearchService(
    repository as never,
    { snapshot: jest.fn() } as never,
    runs as never,
    { enabled: true, pollMs: 60_000, leaseMs: 120_000, batchSize: 100, maxTasksPerUser: 50 },
    { error: jest.fn(), log: jest.fn() } as never,
  )
}

function baseRepository(task: AiScheduledTask): Record<string, jest.Mock> {
  return {
    findDue: jest.fn().mockResolvedValue([task]),
    claimDue: jest.fn().mockResolvedValue(true),
    findTaskById: jest.fn(),
    createExecutionOnce: jest.fn(),
    finishClaim: jest.fn().mockResolvedValue(true),
    findDeferred: jest.fn().mockResolvedValue([]),
    refreshExecutionStatuses: jest.fn().mockResolvedValue(0),
    isTradingDay: jest.fn(),
    findDailyWatermark: jest.fn(),
    findDailyConditionValue: jest.fn(),
    findLatestTriggeredExecution: jest.fn(),
    deferExecution: jest.fn().mockResolvedValue(undefined),
    skipExecution: jest.fn().mockResolvedValue(undefined),
    queueExecution: jest.fn().mockResolvedValue(undefined),
    failExecution: jest.fn().mockResolvedValue(undefined),
  }
}

function createTask(overrides: Partial<AiScheduledTask> = {}): AiScheduledTask {
  return {
    id: 'schedule_1',
    userId: 1,
    clientRequestId: 'f08e6055-6097-4f1e-a447-6772220f11f1',
    name: '收盘研究',
    status: AiScheduledTaskStatus.ACTIVE,
    version: 1,
    trigger: AiScheduledTaskTrigger.CRON,
    cronExpression: '0 30 18 * * 1-5',
    timeZone: 'Asia/Shanghai',
    oneTimeAt: null,
    condition: null,
    tradingDayOnly: false,
    prompt: '总结市场变化。',
    input: {},
    allowedCapabilities: ['INTERNAL_DATA'],
    requiredWatermarks: [],
    workflowKey: 'stock_research',
    workflowVersion: 1,
    workflowContentHash: 'a'.repeat(64),
    promptKey: 'stock_research_system',
    promptVersion: 1,
    promptContentHash: 'b'.repeat(64),
    modelPolicy: AiModelPolicy.AUTO,
    preferredModel: null,
    maxCostCny: 2 as never,
    nextRunAt: new Date('2026-07-22T10:30:00.000Z'),
    leaseOwner: null,
    leaseExpiresAt: null,
    pausedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
    ...overrides,
  }
}

function createExecution(task: AiScheduledTask, overrides: Partial<AiTaskExecution> = {}): AiTaskExecution {
  return {
    id: 'execution_1',
    taskId: task.id,
    userId: task.userId,
    requestKey: 'schedule:2026-07-22T10:30:00.000Z',
    scheduledFor: new Date('2026-07-22T10:30:00.000Z'),
    status: AiTaskExecutionStatus.PENDING,
    taskSnapshot: {},
    gateEvidence: {},
    runId: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    errorCode: null,
    errorMessage: null,
    costCny: null,
    queuedAt: null,
    startedAt: null,
    endedAt: null,
    createdAt: new Date('2026-07-22T10:30:00.000Z'),
    updatedAt: new Date('2026-07-22T10:30:00.000Z'),
    ...overrides,
  }
}
