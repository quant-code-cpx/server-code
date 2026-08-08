import { UserRole, UserStatus } from '@prisma/client'
import { createMarketNewsToolDefinitions } from '../market-news-tools'
import type { ToolAccessContext } from '../../tool-access-context'

describe('NEWS-BIZ-013: get_market_news@1', () => {
  it('只调用本地 Facade，并返回 items/dataThrough/coverage/warnings', async () => {
    const getMarketNews = jest.fn().mockResolvedValue({
      items: [{ articleId: 'c12345678901234567890' }],
      dataThrough: '2026-08-06T04:00:00.000Z',
      coverage: { overallStatus: 'READY' },
      warnings: [],
    })
    const definition = createMarketNewsToolDefinitions({ getMarketNews } as never)[0]
    const result = await definition.execute({ securityCodes: ['600519.SH'], limit: 20 }, context())
    expect(getMarketNews).toHaveBeenCalledWith(7, { securityCodes: ['600519.SH'], limit: 20 })
    expect(result.ok).toBe(true)
    expect(result.data).toEqual(
      expect.objectContaining({
        items: expect.any(Array),
        dataThrough: '2026-08-06T04:00:00.000Z',
        coverage: expect.any(Object),
        warnings: [],
      }),
    )
    expect(result.provenance.sourceType).toBe('DATABASE')
    expect(result.provenance.sourceServices).not.toEqual(
      expect.arrayContaining(['WebSearchService', 'WebFetchService']),
    )
  })

  it('输入 schema 禁止 URL 与原始上游 query', () => {
    const definition = createMarketNewsToolDefinitions({} as never)[0]
    expect(definition.inputSchema.additionalProperties).toBe(false)
    expect(definition.inputSchema.properties as Record<string, unknown>).not.toHaveProperty('url')
    expect(definition.inputSchema.properties as Record<string, unknown>).not.toHaveProperty('query')
  })
})

function context(): ToolAccessContext {
  return {
    userId: 7,
    role: UserRole.USER,
    userStatus: UserStatus.ACTIVE,
    scopeId: 'scope',
    conversationId: 'conversation',
    runId: 'run',
    stepId: 'step',
    traceId: 'trace',
    workflowAllowedTools: ['get_market_news'],
    allowedScopes: ['PUBLIC_MARKET_DATA'],
    callsUsed: 0,
    deadlineAt: new Date(Date.now() + 10_000),
    toolCallId: 'tool-call',
    attempt: 1,
    abortSignal: new AbortController().signal,
  }
}
