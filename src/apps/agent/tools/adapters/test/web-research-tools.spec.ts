import { UserRole, UserStatus } from '@prisma/client'
import { WebSearchError } from 'src/apps/web-search/web-search.errors'
import type { ToolAccessContext } from '../../tool-access-context'
import { ToolSchemaValidator } from '../../tool-schema-validator'
import { createWebResearchToolDefinitions } from '../web-research-tools'

function context(): ToolAccessContext {
  return {
    userId: 7,
    role: UserRole.USER,
    userStatus: UserStatus.ACTIVE,
    scopeId: 'scope_1',
    conversationId: 'conversation_1',
    runId: 'run_1',
    stepId: 'step_1',
    traceId: 'trace_1',
    workflowAllowedTools: ['search_web', 'fetch_web_page'],
    allowedScopes: ['PUBLIC_WEB'],
    callsUsed: 0,
    deadlineAt: new Date(Date.now() + 60_000),
    toolCallId: 'tool_call_1',
    attempt: 1,
    abortSignal: new AbortController().signal,
  }
}

describe('Web research Tool adapters', () => {
  function harness() {
    const search = {
      search: jest.fn().mockResolvedValue({
        provider: 'fake',
        queryHash: 'a'.repeat(64),
        results: [
          {
            sourceId: 'source_1',
            urlToken: 'token.'.padEnd(24, 'x'),
            canonicalUrl: 'https://www.sse.com.cn/notice',
            title: '公告',
            snippet: '搜索摘要',
            publisher: '上海证券交易所',
            sourceType: 'EXCHANGE',
            publishedAt: '2026-07-19T00:00:00.000Z',
            retrievedAt: '2026-07-20T00:00:00.000Z',
            rank: 1,
          },
        ],
        truncated: false,
        retrievedAt: '2026-07-20T00:00:00.000Z',
        warningCodes: ['SEARCH_SNIPPET_NOT_CITABLE'],
      }),
    }
    const fetch = {
      fetch: jest.fn().mockResolvedValue({
        sourceId: 'source_2',
        canonicalUrl: 'https://www.sse.com.cn/notice',
        finalUrl: 'https://www.sse.com.cn/notice',
        title: '公告',
        publisher: '上海证券交易所',
        author: null,
        sourceType: 'EXCHANGE',
        publishedAt: '2026-07-19T00:00:00.000Z',
        retrievedAt: '2026-07-20T00:00:00.000Z',
        mimeType: 'text/html',
        language: 'zh-CN',
        contentHash: 'b'.repeat(64),
        text: '公告正文',
        sections: [
          {
            sectionId: 'section-1',
            heading: null,
            paragraphStart: 0,
            paragraphEnd: 0,
            startOffset: 0,
            endOffset: 4,
          },
        ],
        truncated: false,
        extractionVersion: 'html-text-v1',
        untrustedExternalContent: true,
        riskFlags: [],
        warningCodes: [],
      }),
    }
    return {
      search,
      fetch,
      definitions: createWebResearchToolDefinitions({ search: search as never, fetch: fetch as never }),
    }
  }

  it('两个 Tool schema 严格、context user/run 不来自模型输入', async () => {
    const { definitions, search, fetch } = harness()
    const validator = new ToolSchemaValidator()
    for (const definition of definitions) validator.assertDefinitionSchemas(definition)
    const searchDefinition = definitions.find((item) => item.key === 'search_web')!
    const fetchDefinition = definitions.find((item) => item.key === 'fetch_web_page')!
    expect(validator.validateInput(searchDefinition, { query: '市场 公告', resultLimit: 10, userId: 999 }).valid).toBe(
      false,
    )
    const searchResult = await searchDefinition.execute({ query: '市场 公告', resultLimit: 10 }, context())
    const fetchResult = await fetchDefinition.execute({ urlToken: 'token.'.padEnd(24, 'x') }, context())
    expect(search.search).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, runId: 'run_1' }),
      expect.any(Object),
    )
    expect(fetch.fetch).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, runId: 'run_1' }), expect.any(Object))
    expect(searchResult.citationSourceIds).toEqual([])
    expect(searchResult.warnings.map((warning) => warning.code)).toContain('SEARCH_SNIPPET_NOT_CITABLE')
    expect(fetchResult.citationSourceIds).toEqual(['source_2'])
    expect(fetchResult.provenance.sourceType).toBe('OFFICIAL')
    expect(validator.validateOutput(searchDefinition, searchResult.data).valid).toBe(true)
    expect(validator.validateOutput(fetchDefinition, fetchResult.data).valid).toBe(true)
  })

  it('SSRF/token 拒绝统一映射 PERMISSION_DENIED，不泄露目标 URL', async () => {
    const { definitions, fetch } = harness()
    fetch.fetch.mockRejectedValueOnce(new WebSearchError('BLOCKED', 'http://127.0.0.1:5432/private'))
    const definition = definitions.find((item) => item.key === 'fetch_web_page')!
    await expect(definition.execute({ urlToken: 'token.'.padEnd(24, 'x') }, context())).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      message: '网页来源被安全策略拒绝',
    })
  })
})
