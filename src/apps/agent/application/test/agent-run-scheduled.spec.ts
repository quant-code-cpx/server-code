import { AiAgentRunStatus, AiModelPolicy } from '@prisma/client'
import { AgentRunService } from '../agent-run.service'

describe('AgentRunService.sendScheduled', () => {
  it('冻结 executionId 为请求幂等键，并将任务成本上限传入 interaction', async () => {
    const interactions = {
      sendScheduled: jest.fn().mockResolvedValue({
        conversationId: 'conversation_1',
        triggerMessageId: 'message_user_1',
        responseMessageId: 'message_assistant_1',
        run: { id: 'run_1', status: AiAgentRunStatus.QUEUED },
      }),
    }
    const queue = { enqueueRun: jest.fn().mockResolvedValue(undefined) }
    const service = new AgentRunService(
      interactions as never,
      {} as never,
      {} as never,
      queue as never,
      {} as never,
      {
        warn: jest.fn(),
      } as never,
    )

    const result = await service.sendScheduled({
      userId: 7,
      taskId: 'schedule_1',
      executionId: 'execution_1',
      taskName: '收盘研究',
      scheduledFor: new Date('2026-07-22T10:30:00.000Z'),
      prompt: '总结今日变化。',
      input: { watchlistId: 1 },
      gateEvidence: { reason: 'READY' },
      modelPolicy: AiModelPolicy.AUTO,
      preferredModel: null,
      allowedCapabilities: ['WEB_SEARCH', 'INTERNAL_DATA'],
      maxCostCny: 2,
      workflow: {
        workflowKey: 'stock_research',
        workflowVersion: 1,
        workflowContentHash: 'a'.repeat(64),
        promptKey: 'stock_research_system',
        promptVersion: 1,
        promptContentHash: 'b'.repeat(64),
      },
    })

    expect(interactions.sendScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'execution_1',
        maxCostCny: 2,
        allowedCapabilities: ['INTERNAL_DATA', 'WEB_SEARCH'],
        allowedScopes: ['PUBLIC_MARKET_DATA', 'PUBLIC_WEB', 'USER_PRIVATE'],
      }),
    )
    expect(queue.enqueueRun).toHaveBeenCalledWith('run_1')
    expect(result).toEqual(expect.objectContaining({ runId: 'run_1', runStatus: AiAgentRunStatus.QUEUED }))
  })
})
