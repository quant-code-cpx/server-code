import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AiConclusionLevel,
  AiAgentStepKind,
  AiMessageRole,
  AiMessageStatus,
  AiModelPolicy,
  AiModelCallStatus,
  AiSearchFetchStatus,
  AiSourceType,
  AiToolCallStatus,
  AiVersionStatus,
  Prisma,
  PrismaClient,
  type AiAgentRun,
  type AiAgentStep,
  type AiMessage,
  type User,
} from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import {
  AgentAuditConflictError,
  AgentAuditNotFoundError,
  AgentAuditRepository,
  AgentAuditValidationError,
} from '../agent-audit.repository'
import { sanitizeAndHashAuditPayload, sha256 } from '../agent-audit-sanitizer'
import { CitationRepository } from '../citation.repository'

describe('Agent audit sanitizer', () => {
  it('递归脱敏 secret/hidden reasoning，清理 URL，并生成稳定 canonical hash', () => {
    const left = sanitizeAndHashAuditPayload({
      z: 1,
      password: 'plain-password',
      nested: {
        apiKey: 'plain-api-key',
        hiddenReasoning: 'private chain of thought',
        url: 'https://user:pass@example.com/report?symbol=600000&token=secret#private',
      },
    })
    const right = sanitizeAndHashAuditPayload({
      nested: {
        url: 'https://example.com/report?symbol=600000',
        hiddenReasoning: 'different reasoning',
        apiKey: 'different-key',
      },
      password: 'different-password',
      z: 1,
    })
    const snapshot = JSON.stringify(left.summary)

    expect(snapshot).not.toContain('plain-password')
    expect(snapshot).not.toContain('plain-api-key')
    expect(snapshot).not.toContain('private chain of thought')
    expect(snapshot).not.toContain('user:pass')
    expect(snapshot).not.toContain('token=')
    expect(snapshot).not.toContain('#private')
    expect(left.hash).toBe(right.hash)
  })

  it('限制嵌套深度、数组长度与字符串长度', () => {
    const sanitized = sanitizeAndHashAuditPayload(
      {
        deep: { level1: { level2: { level3: 'hidden' } } },
        list: [1, 2, 3, 4],
        text: '1234567890',
      },
      { maxDepth: 3, maxArrayLength: 2, maxStringLength: 5 },
    )
    const snapshot = JSON.stringify(sanitized.summary)

    expect(snapshot).toContain('[MAX_DEPTH]')
    expect(snapshot).toContain('[TRUNCATED:2]')
    expect(snapshot).toContain('12345[TRUNCATED:5]')
    expect(snapshot).not.toContain('hidden')
  })
})

const runIntegration = process.env.RUN_AGENT_DB_INTEGRATION === 'true'
const integrationDescribe = runIntegration ? describe : describe.skip

function resolveBaseDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) throw new Error('Agent DB integration test 需要 DATABASE_URL 或本地 .env')
  const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(?:"([^"]+)"|([^#\r\n]+))/m)
  const databaseUrl = match?.[1] ?? match?.[2]?.trim()
  if (!databaseUrl) throw new Error('无法从 .env 解析 DATABASE_URL')
  return databaseUrl
}

function makeTemporaryDatabaseUrls(): { adminUrl: string; databaseUrl: string; databaseName: string } {
  const baseUrl = new URL(resolveBaseDatabaseUrl())
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (!localHosts.has(baseUrl.hostname) && process.env.AGENT_DB_TEST_ALLOW_REMOTE !== 'true') {
    throw new Error('Agent DB integration test 默认只允许本机 PostgreSQL')
  }
  const databaseName = `quant_agent_audit_it_${process.pid}_${Date.now()}`
  if (!/^quant_agent_audit_it_\d+_\d+$/.test(databaseName)) throw new Error('临时数据库名称不安全')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  return { adminUrl: adminUrl.toString(), databaseUrl: databaseUrl.toString(), databaseName }
}

integrationDescribe('Agent 审计/引用 Repository — 临时数据库集成测试', () => {
  let admin: PrismaClient | undefined
  let client: PrismaClient | undefined
  let auditRepository: AgentAuditRepository
  let citationRepository: CitationRepository
  let userA: User
  let userB: User
  let messageA: AiMessage
  let runA: AiAgentRun
  let runB: AiAgentRun
  let stepA: AiAgentStep
  let stepB: AiAgentStep
  let databaseName = ''

  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService

  beforeAll(async () => {
    const urls = makeTemporaryDatabaseUrls()
    databaseName = urls.databaseName
    admin = new PrismaClient({ datasources: { db: { url: urls.adminUrl } } })
    await admin.$connect()
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)

    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: urls.databaseUrl },
      stdio: 'pipe',
      timeout: 180_000,
    })

    client = new PrismaClient({ datasources: { db: { url: urls.databaseUrl } } })
    await client.$connect()
    userA = await client.user.create({
      data: { account: `agent_audit_a_${Date.now()}`, password: 'integration-test-only', nickname: 'Agent Audit A' },
    })
    userB = await client.user.create({
      data: { account: `agent_audit_b_${Date.now()}`, password: 'integration-test-only', nickname: 'Agent Audit B' },
    })
    const conversation = await client.aiConversation.create({
      data: { userId: userA.id, title: '审计集成测试', clientRequestId: randomUUID() },
    })
    messageA = await client.aiMessage.create({
      data: {
        userId: userA.id,
        conversationId: conversation.id,
        role: AiMessageRole.ASSISTANT,
        status: AiMessageStatus.COMPLETED,
        contentText: '带证据的结论',
        contentBlocks: [],
        clientRequestId: randomUUID(),
        completedAt: new Date(),
      },
    })
    const triggerA = await client.aiMessage.create({
      data: {
        userId: userA.id,
        conversationId: conversation.id,
        role: AiMessageRole.USER,
        status: AiMessageStatus.COMPLETED,
        contentText: '审计测试请求',
        contentBlocks: [],
        clientRequestId: randomUUID(),
        completedAt: new Date(),
      },
    })
    const publishedAt = new Date()
    const fixturePrompt = await client.aiPromptVersion.create({
      data: {
        promptKey: `audit-fixture-prompt-${randomUUID()}`,
        version: 1,
        status: AiVersionStatus.PUBLISHED,
        template: 'Audit fixture prompt',
        contentHash: sha256('audit-fixture-prompt'),
        createdBy: userA.id,
        publishedBy: userA.id,
        publishedAt,
      },
    })
    const fixtureWorkflow = await client.aiWorkflowVersion.create({
      data: {
        workflowKey: `audit-fixture-workflow-${randomUUID()}`,
        version: 1,
        status: AiVersionStatus.PUBLISHED,
        definition: { nodes: ['audit'] },
        contentHash: sha256('audit-fixture-workflow'),
        createdBy: userA.id,
        publishedBy: userA.id,
        publishedAt,
      },
    })
    runA = await client.aiAgentRun.create({
      data: {
        userId: userA.id,
        conversationId: conversation.id,
        triggerMessageId: triggerA.id,
        responseMessageId: messageA.id,
        clientRequestId: randomUUID(),
        requestHash: sha256('audit-run-a'),
        traceId: `trace_${randomUUID()}`,
        workflowVersionId: fixtureWorkflow.id,
        promptVersionId: fixturePrompt.id,
        toolPolicyVersion: 'audit-policy-v1',
        modelPolicy: AiModelPolicy.AUTO,
        deadlineAt: new Date(Date.now() + 180_000),
      },
    })
    stepA = await client.aiAgentStep.create({
      data: {
        runId: runA.id,
        stepKey: 'audit-step-a',
        kind: AiAgentStepKind.TOOL,
        ordinal: 0,
        inputHash: sha256('{}'),
      },
    })

    const conversationB = await client.aiConversation.create({
      data: { userId: userB.id, title: '审计租户 B', clientRequestId: randomUUID() },
    })
    const triggerB = await client.aiMessage.create({
      data: {
        userId: userB.id,
        conversationId: conversationB.id,
        role: AiMessageRole.USER,
        status: AiMessageStatus.COMPLETED,
        contentText: '租户 B 审计请求',
        contentBlocks: [],
        clientRequestId: randomUUID(),
        completedAt: new Date(),
      },
    })
    const responseB = await client.aiMessage.create({
      data: {
        userId: userB.id,
        conversationId: conversationB.id,
        role: AiMessageRole.ASSISTANT,
        status: AiMessageStatus.PENDING,
        contentBlocks: [],
        clientRequestId: randomUUID(),
      },
    })
    runB = await client.aiAgentRun.create({
      data: {
        userId: userB.id,
        conversationId: conversationB.id,
        triggerMessageId: triggerB.id,
        responseMessageId: responseB.id,
        clientRequestId: randomUUID(),
        requestHash: sha256('audit-run-b'),
        traceId: `trace_${randomUUID()}`,
        workflowVersionId: fixtureWorkflow.id,
        promptVersionId: fixturePrompt.id,
        toolPolicyVersion: 'audit-policy-v1',
        modelPolicy: AiModelPolicy.AUTO,
        deadlineAt: new Date(Date.now() + 180_000),
      },
    })
    stepB = await client.aiAgentStep.create({
      data: {
        runId: runB.id,
        stepKey: 'audit-step-b',
        kind: AiAgentStepKind.TOOL,
        ordinal: 0,
        inputHash: sha256('{}'),
      },
    })
    auditRepository = new AgentAuditRepository(client as unknown as PrismaService, logger)
    citationRepository = new CitationRepository(client as unknown as PrismaService, logger)
  }, 240_000)

  afterAll(async () => {
    await client?.$disconnect()
    if (admin && databaseName) {
      await admin.$queryRaw(
        Prisma.sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${databaseName} AND pid <> pg_backend_pid()`,
      )
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`)
      await admin.$disconnect()
    }
  }, 60_000)

  it('Tool 调用开始/完成幂等，不同输出不能覆盖或制造第二份终态', async () => {
    const command = {
      userId: userA.id,
      scopeId: randomUUID(),
      runId: runA.id,
      stepId: stepA.id,
      logicalNodeKey: 'market-history',
      toolName: 'get_stock_price_history',
      toolVersion: '1.0.0',
      input: { tsCode: '600000.SH', authorization: 'Bearer secret-token', hiddenReasoning: 'private' },
    }
    const first = await auditRepository.beginToolCall(command)
    const repeatedBegin = await auditRepository.beginToolCall(command)
    const completed = await auditRepository.completeToolCall(userA.id, first.id, {
      output: { rows: [{ tradeDate: '2026-07-18', close: 12.34 }] },
      dataAsOf: new Date('2026-07-18T00:00:00.000Z'),
      dataThrough: new Date('2026-07-18T00:00:00.000Z'),
      marketTimezone: 'Asia/Shanghai',
      dataVersion: 'daily:600000.SH:20260718',
      rowCount: 1,
    })
    const repeatedComplete = await auditRepository.completeToolCall(userA.id, first.id, {
      output: { rows: [{ tradeDate: '2026-07-18', close: 12.34 }] },
      rowCount: 999,
    })

    expect(repeatedBegin.id).toBe(first.id)
    expect(JSON.stringify(first.inputSummary)).not.toContain('secret-token')
    expect(JSON.stringify(first.inputSummary)).not.toContain('private')
    expect(completed.status).toBe(AiToolCallStatus.SUCCEEDED)
    expect(repeatedComplete.id).toBe(completed.id)
    expect(repeatedComplete.rowCount).toBe(1)
    await expect(
      auditRepository.completeToolCall(userA.id, first.id, { output: { rows: [{ close: 99 }] } }),
    ).rejects.toBeInstanceOf(AgentAuditConflictError)
    expect(await client!.aiToolCall.count({ where: { id: first.id } })).toBe(1)
    await expect(
      client!.aiToolCall.update({
        where: { id: first.id },
        data: { status: AiToolCallStatus.FAILED, errorClass: 'OverwriteAttempt' },
      }),
    ).rejects.toThrow('terminal AI tool call is immutable')
  })

  it('模型调用保留 Decimal(18,8) 精度；重复完成不重复计费，不同输出拒绝', async () => {
    const prompt = await auditRepository.createPromptDraft({
      promptKey: `research-${randomUUID()}`,
      version: 1,
      template: '根据 {{facts}} 生成结论',
      inputSchema: { type: 'object', properties: { maxTokens: { type: 'integer' } } },
      outputSchema: { type: 'object' },
      createdBy: userA.id,
    })
    const published = await auditRepository.publishPromptVersion(prompt.id, userA.id)
    expect(JSON.stringify(published.inputSchema)).toContain('maxTokens')
    const call = await auditRepository.beginModelCall({
      userId: userA.id,
      scopeId: randomUUID(),
      runId: runA.id,
      stepId: stepA.id,
      promptVersionId: published.id,
      provider: 'openai-compatible',
      model: 'research-model',
      purpose: 'SYNTHESIZE',
      streaming: true,
      request: { systemPrompt: 'full private prompt', facts: ['public fact'], apiKey: 'secret-key' },
    })
    const finished = await auditRepository.finishModelCall(userA.id, call.id, {
      output: { text: '结论 A' },
      inputTokens: 101,
      outputTokens: 29,
      cachedTokens: 3,
      reasoningTokens: 7,
      cost: '0.12345678',
      costCurrency: 'usd',
      latencyMs: 88,
      finishReason: 'stop',
    })
    const repeated = await auditRepository.finishModelCall(userA.id, call.id, {
      output: { text: '结论 A' },
      cost: '99.00000000',
      costCurrency: 'USD',
    })

    expect(JSON.stringify(call.requestSummary)).not.toContain('full private prompt')
    expect(JSON.stringify(call.requestSummary)).not.toContain('secret-key')
    expect(finished.cost?.toFixed(8)).toBe('0.12345678')
    expect(finished.costCurrency).toBe('USD')
    expect(repeated.cost?.toFixed(8)).toBe('0.12345678')
    await expect(
      auditRepository.finishModelCall(userA.id, call.id, { output: { text: '冲突结论' } }),
    ).rejects.toBeInstanceOf(AgentAuditConflictError)
    await expect(
      auditRepository.finishModelCall(userB.id, call.id, { output: { text: '结论 A' } }),
    ).rejects.toBeInstanceOf(AgentAuditNotFoundError)
    await expect(
      client!.aiModelCall.update({
        where: { id: call.id },
        data: { status: AiModelCallStatus.FAILED, errorClass: 'OverwriteAttempt' },
      }),
    ).rejects.toThrow('terminal AI model call is immutable')
  })

  it('失败审计幂等并脱敏 error message', async () => {
    const call = await auditRepository.beginToolCall({
      userId: userA.id,
      scopeId: randomUUID(),
      runId: runA.id,
      stepId: stepA.id,
      logicalNodeKey: 'failure-case',
      toolName: 'get_market_snapshot',
      toolVersion: '1.0.0',
      input: {},
    })
    const failed = await auditRepository.failToolCall(userA.id, call.id, {
      errorClass: 'UpstreamError',
      errorMessage: 'https://user:password@example.com/fail?token=secret#trace',
    })
    const repeated = await auditRepository.failToolCall(userA.id, call.id, {
      errorClass: 'DifferentError',
      errorMessage: 'different secret',
    })

    expect(repeated.id).toBe(failed.id)
    expect(failed.errorClass).toBe('UpstreamError')
    expect(failed.errorMessage).not.toContain('password')
    expect(failed.errorMessage).not.toContain('token=')
    expect(failed.errorMessage).not.toContain('#trace')
  })

  it('SearchSource 按 canonical URL hash + content hash 全局去重', async () => {
    const contentHash = sha256('same-source-body')
    const first = await citationRepository.createSearchSource({
      firstSeenUserId: userA.id,
      sourceType: AiSourceType.OFFICIAL,
      url: 'https://user:pass@example.com/report?symbol=600000&token=secret#part',
      title: '交易所公告',
      publisher: '交易所',
      fetchedAt: new Date('2026-07-19T00:00:00.000Z'),
      contentHash,
      fetchStatus: AiSearchFetchStatus.FETCHED,
    })
    const repeated = await citationRepository.createSearchSource({
      firstSeenUserId: userB.id,
      sourceType: AiSourceType.OFFICIAL,
      url: 'https://example.com/report?symbol=600000&authorization=other#new',
      title: '不同标题不覆盖首次快照',
      fetchedAt: new Date('2026-07-20T00:00:00.000Z'),
      contentHash,
    })

    expect(repeated.id).toBe(first.id)
    expect(first.canonicalUrl).toBe('https://example.com/report?symbol=600000')
    expect(first.canonicalUrl).not.toContain('user:pass')
    expect(first.canonicalUrl).not.toContain('token')
    expect(
      await client!.aiSearchSource.count({ where: { canonicalUrlHash: first.canonicalUrlHash, contentHash } }),
    ).toBe(1)
  })

  it('Citation 事务验证单一来源、owner、hash、locator，并支持幂等读取', async () => {
    const source = await citationRepository.createSearchSource({
      firstSeenUserId: userA.id,
      sourceType: AiSourceType.OFFICIAL,
      url: `https://example.com/disclosure/${randomUUID()}`,
      title: '上市公司公告',
      fetchedAt: new Date(),
      contentHash: sha256('citation-source-body'),
      fetchStatus: AiSearchFetchStatus.FETCHED,
    })
    const tool = await auditRepository.beginToolCall({
      userId: userA.id,
      scopeId: randomUUID(),
      runId: runA.id,
      stepId: stepA.id,
      logicalNodeKey: 'citation-tool',
      toolName: 'get_financial_indicators',
      toolVersion: '1.0.0',
      input: { tsCode: '600000.SH' },
    })
    await auditRepository.completeToolCall(userA.id, tool.id, {
      output: { roe: 12.3, annDate: '2026-04-30' },
      dataAsOf: new Date('2025-12-31T00:00:00.000Z'),
      dataThrough: new Date('2026-04-30T00:00:00.000Z'),
      rowCount: 1,
    })
    const inputs = [
      {
        blockId: 'answer-1',
        claimKey: 'claim-web',
        conclusionLevel: AiConclusionLevel.FACT,
        searchSourceId: source.id,
        locator: { section: '经营情况', paragraph: 3 },
        startOffset: 10,
        endOffset: 20,
        quote: '营业收入增长',
      },
      {
        blockId: 'answer-1',
        claimKey: 'claim-db',
        conclusionLevel: AiConclusionLevel.PROGRAM_CALCULATION,
        toolCallId: tool.id,
        sourceType: AiSourceType.DATABASE,
        sourceTitle: 'FinaIndicator 快照',
        locator: { tsCode: '600000.SH', annDate: '2026-04-30', field: 'roe' },
      },
    ]
    const first = await citationRepository.attachCitations(userA.id, messageA.id, inputs)
    const repeated = await citationRepository.attachCitations(userA.id, messageA.id, inputs)
    const listed = await citationRepository.listCitationsForMessage(userA.id, messageA.id)

    expect(first).toHaveLength(2)
    expect(repeated.map((item) => item.publicId)).toEqual(first.map((item) => item.publicId))
    expect(listed).toHaveLength(2)
    await expect(citationRepository.listCitationsForMessage(userB.id, messageA.id)).rejects.toBeInstanceOf(
      AgentAuditNotFoundError,
    )
    await expect(
      citationRepository.attachCitations(userA.id, messageA.id, [
        {
          ...inputs[0],
          toolCallId: tool.id,
        },
      ]),
    ).rejects.toBeInstanceOf(AgentAuditValidationError)
    await expect(
      citationRepository.attachCitations(userA.id, messageA.id, [
        {
          blockId: 'bad-locator',
          claimKey: 'bad-locator',
          conclusionLevel: AiConclusionLevel.FACT,
          searchSourceId: source.id,
          locator: {},
        },
      ]),
    ).rejects.toBeInstanceOf(AgentAuditValidationError)
    await expect(
      citationRepository.attachCitations(userA.id, messageA.id, [
        {
          blockId: 'missing-source',
          claimKey: 'missing-source',
          conclusionLevel: AiConclusionLevel.FACT,
          locator: { field: 'close' },
        },
      ]),
    ).rejects.toBeInstanceOf(AgentAuditValidationError)

    const otherTenantTool = await auditRepository.beginToolCall({
      userId: userB.id,
      scopeId: randomUUID(),
      runId: runB.id,
      stepId: stepB.id,
      logicalNodeKey: 'cross-tenant-tool',
      toolName: 'get_stock_overview',
      toolVersion: '1.0.0',
      input: { tsCode: '000001.SZ' },
    })
    await auditRepository.completeToolCall(userB.id, otherTenantTool.id, { output: { name: '平安银行' } })
    await expect(
      citationRepository.attachCitations(userA.id, messageA.id, [
        {
          blockId: 'cross-tenant-tool',
          claimKey: 'cross-tenant-tool',
          conclusionLevel: AiConclusionLevel.FACT,
          toolCallId: otherTenantTool.id,
          sourceType: AiSourceType.DATABASE,
          sourceTitle: '跨租户 Tool',
          locator: { field: 'name' },
        },
      ]),
    ).rejects.toBeInstanceOf(AgentAuditNotFoundError)

    await expect(
      client!.aiCitation.create({
        data: {
          userId: userB.id,
          messageId: messageA.id,
          blockId: 'cross-tenant',
          claimKey: 'cross-tenant',
          conclusionLevel: AiConclusionLevel.FACT,
          sourceType: source.sourceType,
          searchSourceId: source.id,
          sourceTitle: source.title,
          canonicalUrl: source.canonicalUrl,
          retrievedAt: source.fetchedAt,
          locator: { section: 'x' },
          contentHash: source.contentHash,
          citationKeyHash: sha256('cross-tenant'),
        },
      }),
    ).rejects.toThrow('AI citation message owner mismatch')
    await expect(
      client!.aiCitation.create({
        data: {
          userId: userA.id,
          messageId: messageA.id,
          blockId: 'bad-hash',
          claimKey: 'bad-hash',
          conclusionLevel: AiConclusionLevel.FACT,
          sourceType: source.sourceType,
          searchSourceId: source.id,
          sourceTitle: source.title,
          canonicalUrl: source.canonicalUrl,
          retrievedAt: source.fetchedAt,
          locator: { section: 'x' },
          contentHash: sha256('different-content'),
          citationKeyHash: sha256('bad-hash'),
        },
      }),
    ).rejects.toThrow('AI citation search source snapshot mismatch')
  })

  it('Prompt/Workflow 发布后内容由 DB trigger 冻结', async () => {
    const prompt = await auditRepository.createPromptDraft({
      promptKey: `immutable-prompt-${randomUUID()}`,
      version: 1,
      template: '不可变 prompt',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      createdBy: userA.id,
    })
    await auditRepository.publishPromptVersion(prompt.id, userA.id)
    await expect(
      client!.aiPromptVersion.update({ where: { id: prompt.id }, data: { template: '篡改 prompt' } }),
    ).rejects.toThrow('published AI version content is immutable')

    const workflow = await auditRepository.createWorkflowDraft({
      workflowKey: `immutable-workflow-${randomUUID()}`,
      version: 1,
      definition: { nodes: [{ key: 'load_context' }, { key: 'synthesize' }] },
      toolAllowlist: ['get_stock_overview'],
      createdBy: userA.id,
    })
    await auditRepository.publishWorkflowVersion(workflow.id, userA.id)
    await expect(
      client!.aiWorkflowVersion.update({ where: { id: workflow.id }, data: { definition: { nodes: [] } } }),
    ).rejects.toThrow('published AI version content is immutable')
    await expect(client!.aiWorkflowVersion.delete({ where: { id: workflow.id } })).rejects.toThrow(
      'published AI version cannot be deleted',
    )
  })

  it('migration 落地关键 CHECK、FK 与 trigger', async () => {
    const constraints = await client!.$queryRaw<Array<{ name: string }>>(Prisma.sql`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conrelid IN (
        'ai_tool_calls'::regclass,
        'ai_model_calls'::regclass,
        'ai_citations'::regclass,
        'ai_prompt_versions'::regclass,
        'ai_workflow_versions'::regclass
      )
    `)
    const triggers = await client!.$queryRaw<Array<{ name: string }>>(Prisma.sql`
      SELECT tgname AS name
      FROM pg_trigger
      WHERE tgrelid IN (
        'ai_tool_calls'::regclass,
        'ai_model_calls'::regclass,
        'ai_citations'::regclass,
        'ai_prompt_versions'::regclass,
        'ai_workflow_versions'::regclass
      ) AND NOT tgisinternal
    `)
    const constraintNames = constraints.map((item) => item.name)
    const triggerNames = triggers.map((item) => item.name)

    expect(constraintNames).toEqual(
      expect.arrayContaining([
        'ai_model_calls_prompt_version_id_fkey',
        'ai_model_calls_token_check',
        'ai_model_calls_cost_check',
        'ai_citations_source_check',
        'ai_citations_offset_check',
      ]),
    )
    expect(triggerNames).toEqual(
      expect.arrayContaining([
        'ai_tool_calls_status_transition_trigger',
        'ai_model_calls_status_transition_trigger',
        'ai_citations_integrity_trigger',
        'ai_prompt_versions_immutable_trigger',
        'ai_workflow_versions_immutable_trigger',
      ]),
    )
  })
})

jest.setTimeout(300_000)
