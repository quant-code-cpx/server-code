import { AiAgentRunStatus } from '@prisma/client'
import { buildAgentExecutionConfig } from 'src/config/agent-execution.config'
import { WorkflowEngineService } from '../workflow-engine.service'
import { WorkflowCancelledError } from '../workflow.errors'

describe('Workflow lease heartbeat cancellation', () => {
  it('heartbeat 发现 CANCEL_REQUESTED 时，在长节点开始前中止并传播 AbortSignal', async () => {
    const runs = {
      heartbeat: jest.fn().mockResolvedValue({ status: AiAgentRunStatus.CANCEL_REQUESTED }),
    }
    const handler = jest.fn().mockResolvedValue({})
    const node = (key: string) => ({ key })
    const engine = new WorkflowEngineService(
      runs as never,
      {} as never,
      {} as never,
      buildAgentExecutionConfig({}),
      { log: jest.fn() } as never,
      node('load_context') as never,
      node('plan') as never,
      node('authorize_tools') as never,
      node('execute_tools') as never,
      node('synthesize') as never,
      node('validate_citations') as never,
      node('persist') as never,
      node('complete') as never,
    )

    const invokeHeartbeat = engine as unknown as {
      withLeaseHeartbeat(
        command: { run: { id: string }; workerId: string },
        callback: (signal: AbortSignal) => Promise<unknown>,
      ): Promise<unknown>
    }
    await expect(
      invokeHeartbeat.withLeaseHeartbeat({ run: { id: 'run_1' }, workerId: 'worker_1' }, handler),
    ).rejects.toBeInstanceOf(WorkflowCancelledError)
    expect(handler).not.toHaveBeenCalled()
  })
})
