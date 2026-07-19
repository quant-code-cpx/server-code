import { Job, UnrecoverableError } from 'bullmq'
import { AgentRunClaimError } from 'src/apps/agent/execution/agent-execution.errors'
import { buildAgentQueueConfig } from 'src/config/agent-queue.config'
import { AgentProcessor, createWorkerIdentity } from '../agent.processor'
import { AGENT_RUN_JOB_NAME } from '../agent.queue.constants'

function makeJob(data: unknown = { schemaVersion: 1, runId: 'run_1' }, name = AGENT_RUN_JOB_NAME) {
  return {
    id: 'run_1',
    name,
    data,
    attemptsMade: 0,
    attemptsStarted: 1,
  } as Job
}

describe('AgentProcessor', () => {
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const stalled = { inc: jest.fn() }

  beforeEach(() => jest.clearAllMocks())

  it.each(['COMPLETED', 'FAILED', 'CANCELLED'] as const)(
    '业务终态 %s 直接完成 Bull job，不触发重试',
    async (status) => {
      const orchestrator = { resume: jest.fn().mockResolvedValue({ status, runId: 'run_1' }) }
      const processor = new AgentProcessor(
        orchestrator as never,
        buildAgentQueueConfig({}),
        logger as never,
        stalled as never,
      )

      await expect(processor.process(makeJob() as never)).resolves.toEqual({ status, runId: 'run_1' })
      expect(orchestrator.resume).toHaveBeenCalledWith(
        'run_1',
        expect.objectContaining({ workerId: expect.any(String), signal: expect.any(AbortSignal) }),
      )
    },
  )

  it('非法正文 payload、未知 job name、错误 jobId 均不可恢复，不消耗重试', async () => {
    const processor = new AgentProcessor({ resume: jest.fn() } as never, buildAgentQueueConfig({}), logger as never)
    await expect(
      processor.process(makeJob({ schemaVersion: 1, runId: 'run_1', prompt: 'secret' }) as never),
    ).rejects.toBeInstanceOf(UnrecoverableError)
    await expect(processor.process(makeJob(undefined, 'unknown') as never)).rejects.toBeInstanceOf(UnrecoverableError)
    await expect(processor.process({ ...makeJob(), id: 'different' } as never)).rejects.toBeInstanceOf(
      UnrecoverableError,
    )
  })

  it('lease 冲突等基础设施错误向 BullMQ 冒泡；不可恢复 claim 转 IGNORED', async () => {
    const retryable = new AgentRunClaimError('LEASE_HELD', true, 'lease held')
    const retryProcessor = new AgentProcessor(
      { resume: jest.fn().mockRejectedValue(retryable) } as never,
      buildAgentQueueConfig({}),
      logger as never,
    )
    await expect(retryProcessor.process(makeJob() as never)).rejects.toBe(retryable)

    const terminal = new AgentRunClaimError('TERMINAL', false, 'terminal')
    const terminalProcessor = new AgentProcessor(
      { resume: jest.fn().mockRejectedValue(terminal) } as never,
      buildAgentQueueConfig({}),
      logger as never,
    )
    await expect(terminalProcessor.process(makeJob() as never)).resolves.toEqual({
      status: 'IGNORED',
      runId: 'run_1',
      reason: 'TERMINAL',
    })
  })

  it('每次 delivery 使用新 worker identity，禁止过期 lease 复用 identity', () => {
    const job = makeJob()
    expect(createWorkerIdentity(job)).not.toBe(createWorkerIdentity(job))
  })

  it('SIGTERM 中止 active job，后续 job 拒绝领取', async () => {
    const orchestrator = {
      resume: jest.fn(
        (_runId: string, context: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true })
          }),
      ),
    }
    const processor = new AgentProcessor(orchestrator as never, buildAgentQueueConfig({}), logger as never)
    const pending = processor.process(makeJob() as never)
    await Promise.resolve()
    processor.onApplicationShutdown('SIGTERM')

    await expect(pending).rejects.toThrow('SIGTERM')
    await expect(processor.process(makeJob() as never)).rejects.toThrow('正在关闭')
  })

  it('stalled 事件记录指标', () => {
    const processor = new AgentProcessor(
      { resume: jest.fn() } as never,
      buildAgentQueueConfig({}),
      logger as never,
      stalled as never,
    )
    processor.onStalled('run_1')
    expect(stalled.inc).toHaveBeenCalledWith({ queue: 'agent-execution' })
  })
})
