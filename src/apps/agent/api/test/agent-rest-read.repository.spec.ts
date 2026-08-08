import { AgentRestReadRepository } from '../agent-rest-read.repository'

describe('AgentRestReadRepository', () => {
  it('历史消息列表保留失败运行的错误码和安全错误信息', async () => {
    const endedAt = new Date('2026-08-07T11:48:00.000Z')
    const prisma = {
      aiConversation: { findFirst: jest.fn().mockResolvedValue({ id: 'conversation-1' }) },
      aiMessage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'message-1',
            role: 'ASSISTANT',
            status: 'FAILED',
            contentText: '',
            contentBlocks: [],
            contentSchemaVersion: 1,
            version: 1,
            parentMessageId: null,
            modelName: 'deepseek-v4-flash',
            responseRuns: [
              {
                id: 'run-1',
                status: 'FAILED',
                statusVersion: 7,
                endedAt,
                errorCode: 'MODEL_PROVIDER_UNAVAILABLE',
                errorMessage: '模型供应商返回 HTTP 502，请检查上游服务状态或协议兼容日志',
              },
            ],
            triggeredRuns: [],
            citations: [],
            createdAt: new Date('2026-08-07T11:47:00.000Z'),
            completedAt: endedAt,
          },
        ]),
      },
    }
    const repository = new AgentRestReadRepository(prisma as never)

    await expect(repository.listMessages(1, 'conversation-1', null, 20)).resolves.toMatchObject({
      items: [
        {
          messageId: 'message-1',
          run: {
            runId: 'run-1',
            status: 'FAILED',
            errorCode: 'MODEL_PROVIDER_UNAVAILABLE',
            errorMessage: '模型供应商返回 HTTP 502，请检查上游服务状态或协议兼容日志',
            endedAt: endedAt.toISOString(),
          },
        },
      ],
    })
  })
})
