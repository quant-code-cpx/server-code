import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type INestApplicationContext } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import {
  AiAgentRunStatus,
  AiMemoryCategory,
  AiMemorySensitivity,
  AiMessageRole,
  AiMessageStatus,
  AiModelPolicy,
  Prisma,
  PrismaClient,
  UserRole,
} from '@prisma/client'
import configs from 'src/config'
import { AgentExecutionConfig } from 'src/config/agent-execution.config'
import { AgentContextConfig } from 'src/config/agent-context.config'
import { AgentToolsConfig } from 'src/config/agent-tools.config'
import { SharedModule } from 'src/shared/shared.module'
import { PrismaService } from 'src/shared/prisma.service'
import { AgentAuditModule } from '../../audit/agent-audit.module'
import { AgentAuditRepository } from '../../audit/agent-audit.repository'
import { AgentConversationRepository } from '../../conversation/agent-conversation.repository'
import { canonicalJson } from '../../conversation/agent-conversation.utils'
import { AgentMessageRepository } from '../../conversation/agent-message.repository'
import { ContextBuilderService } from '../../memory/context-builder.service'
import { ContextTokenEstimator } from '../../memory/context-token-estimator'
import { ConversationSummaryRepository } from '../../memory/conversation-summary.repository'
import { ConversationSummaryService } from '../../memory/conversation-summary.service'
import { ConversationSummaryGeneratorService } from '../../memory/conversation-summary-generator.service'
import { UserMemoryRepository } from '../../memory/user-memory.repository'
import { AgentRunRepository } from '../../execution/agent-run.repository'
import { AgentExecutionModule } from '../../execution/agent-execution.module'
import { ModelGatewayModule } from '../../model-gateway/model-gateway.module'
import { AgentOrchestratorService } from '../../orchestrator/agent-orchestrator.service'
import { TOOL_EXECUTION_OBSERVER } from '../../tools/contracts/tool-observer'
import { ToolExecutorService } from '../../tools/tool-executor.service'
import { ToolPolicyService } from '../../tools/tool-policy.service'
import { AGENT_TOOL_DEFINITIONS, ToolRegistryService } from '../../tools/tool-registry.service'
import { ToolRunLimiterService } from '../../tools/tool-run-limiter.service'
import { ToolSchemaValidator } from '../../tools/tool-schema-validator'
import { CitationCoverageService } from '../citation-coverage.service'
import { AuthorizeToolsNode } from '../nodes/authorize-tools.node'
import { CompleteNode } from '../nodes/complete.node'
import { ExecuteToolsNode } from '../nodes/execute-tools.node'
import { LoadContextNode } from '../nodes/load-context.node'
import { PersistNode } from '../nodes/persist.node'
import { PlanNode } from '../nodes/plan.node'
import { SynthesizeNode } from '../nodes/synthesize.node'
import { ValidateCitationsNode } from '../nodes/validate-citations.node'
import { ResearchPlanCompilerService } from '../research-plan-compiler.service'
import { WorkflowBudgetService } from '../workflow-budget.service'
import { WorkflowContextService } from '../workflow-context.service'
import { WorkflowEngineService } from '../workflow-engine.service'
import { WorkflowFinalizationService } from '../workflow-finalization.service'
import { WorkflowModelService } from '../workflow-model.service'
import { WorkflowRegistryService } from '../workflow-registry.service'
import { AGENT_WORKFLOW_DEFINITIONS } from '../workflow-registry.service'
import { WorkflowToolService } from '../workflow-tool.service'
import { STOCK_RESEARCH_WORKFLOW_V1 } from '../workflows/stock-research.v1'

const runIntegration = process.env.RUN_AGENT_DB_INTEGRATION === 'true'
const integrationDescribe = runIntegration ? describe : describe.skip

integrationDescribe('Stock research workflow v1 - 真实 PostgreSQL + fake Model 集成', () => {
  let admin: PrismaClient | undefined
  let app: INestApplicationContext | undefined
  let databaseName = ''
  let originalDatabaseUrl: string | undefined

  beforeAll(async () => {
    const urls = makeTemporaryDatabaseUrls()
    databaseName = urls.databaseName
    originalDatabaseUrl = process.env.DATABASE_URL
    admin = new PrismaClient({ datasources: { db: { url: urls.adminUrl } } })
    await admin.$connect()
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    execFileSync('corepack', ['pnpm', 'exec', 'prisma', 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: urls.databaseUrl },
      stdio: 'pipe',
      timeout: 180_000,
    })
    process.env.DATABASE_URL = urls.databaseUrl
    process.env.AGENT_MODEL_PROVIDER = 'fake'
    process.env.AGENT_TOOLS_ENABLED = ''
    process.env.TUSHARE_SYNC_ENABLED = 'false'
    process.env.TUSHARE_BOOTSTRAP_ON_START = 'false'
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'], load: [...Object.values(configs)] }),
        ConfigModule.forFeature(AgentExecutionConfig),
        ConfigModule.forFeature(AgentContextConfig),
        ConfigModule.forFeature(AgentToolsConfig),
        SharedModule,
        ModelGatewayModule,
        AgentExecutionModule,
        AgentAuditModule,
      ],
      providers: [
        AgentConversationRepository,
        AgentMessageRepository,
        ConversationSummaryRepository,
        ConversationSummaryService,
        ConversationSummaryGeneratorService,
        UserMemoryRepository,
        ContextTokenEstimator,
        ContextBuilderService,
        ToolSchemaValidator,
        ToolRegistryService,
        ToolPolicyService,
        ToolRunLimiterService,
        ToolExecutorService,
        WorkflowRegistryService,
        WorkflowBudgetService,
        ResearchPlanCompilerService,
        WorkflowContextService,
        WorkflowModelService,
        WorkflowToolService,
        CitationCoverageService,
        WorkflowFinalizationService,
        LoadContextNode,
        PlanNode,
        AuthorizeToolsNode,
        ExecuteToolsNode,
        SynthesizeNode,
        ValidateCitationsNode,
        PersistNode,
        CompleteNode,
        WorkflowEngineService,
        AgentOrchestratorService,
        { provide: AGENT_TOOL_DEFINITIONS, useValue: Object.freeze([]) },
        { provide: TOOL_EXECUTION_OBSERVER, useValue: Object.freeze({}) },
        { provide: AGENT_WORKFLOW_DEFINITIONS, useValue: Object.freeze([STOCK_RESEARCH_WORKFLOW_V1]) },
      ],
    }).compile()
    await module.init()
    app = module
  }, 240_000)

  afterAll(async () => {
    await app?.close()
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl
    else delete process.env.DATABASE_URL
    if (admin && databaseName) {
      await admin.$queryRaw(
        Prisma.sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${databaseName} AND pid <> pg_backend_pid()`,
      )
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`)
      await admin.$disconnect()
    }
  }, 60_000)

  it('真实 Repository 从 QUEUED 执行到 COMPLETED，8 Step、2 ModelCall、0 ToolCall 且最终消息原子落库', async () => {
    const prisma = app!.get(PrismaService)
    const conversations = app!.get(AgentConversationRepository)
    const messages = app!.get(AgentMessageRepository)
    const audit = app!.get(AgentAuditRepository)
    const registry = app!.get(WorkflowRegistryService)
    const runs = app!.get(AgentRunRepository)
    const orchestrator = app!.get(AgentOrchestratorService)
    const user = await prisma.user.create({
      data: {
        account: `agent_workflow_${Date.now()}`,
        password: 'integration-test-only',
        nickname: 'Agent Workflow Integration',
        role: UserRole.ADMIN,
      },
    })
    const snapshot = registry.snapshot('stock_research', 1)
    const promptDraft = await audit.createPromptDraft({
      promptKey: snapshot.prompt.promptKey,
      version: snapshot.prompt.version,
      template: snapshot.prompt.template,
      inputSchema: snapshot.prompt.inputSchema,
      outputSchema: snapshot.prompt.outputSchema,
      createdBy: user.id,
    })
    const prompt = await audit.publishPromptVersion(promptDraft.id, user.id)
    const workflowDraft = await audit.createWorkflowDraft({
      workflowKey: snapshot.workflowKey,
      version: snapshot.version,
      definition: snapshot.definition,
      toolAllowlist: snapshot.toolAllowlist,
      inputSchema: snapshot.inputSchema,
      outputSchema: snapshot.outputSchema,
      createdBy: user.id,
    })
    const workflow = await audit.publishWorkflowVersion(workflowDraft.id, user.id)
    const conversation = await conversations.createConversation(user.id, {
      clientRequestId: randomUUID(),
      title: '普通量化能力问答',
      modelPolicy: AiModelPolicy.AUTO,
      preferredModel: null,
    })
    const trigger = await messages.appendMessage(user.id, conversation.id, {
      clientRequestId: randomUUID(),
      role: AiMessageRole.USER,
      status: AiMessageStatus.COMPLETED,
      contentText: '你能做什么？',
      contentBlocks: [],
    })
    const response = await messages.appendMessage(user.id, conversation.id, {
      clientRequestId: randomUUID(),
      role: AiMessageRole.ASSISTANT,
      status: AiMessageStatus.PENDING,
      contentBlocks: [],
      parentMessageId: trigger.id,
    })
    const run = await runs.createRun({
      userId: user.id,
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      responseMessageId: response.id,
      clientRequestId: randomUUID(),
      traceId: `trace_${randomUUID()}`,
      workflowVersionId: workflow.id,
      promptVersionId: prompt.id,
      toolPolicyVersion: 'tool-policy-v1',
      modelPolicy: AiModelPolicy.AUTO,
      inputSnapshot: { allowedCapabilities: [], allowedScopes: [] },
      budget: { maxToolCalls: 0, maxParallelTools: 1, maxCost: 1 },
      maxAttempts: 3,
      deadlineAt: new Date(Date.now() + 170_000),
    })

    const terminal = await orchestrator.resume(run.id, { workerId: `worker_${randomUUID()}` })

    expect(terminal).toEqual({ status: 'COMPLETED', runId: run.id, finalMessageId: response.id })
    expect(await prisma.aiAgentRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: AiAgentRunStatus.COMPLETED,
      leaseOwner: null,
    })
    expect(await prisma.aiAgentStep.count({ where: { runId: run.id } })).toBe(8)
    expect(await prisma.aiModelCall.count({ where: { runId: run.id } })).toBe(2)
    expect(await prisma.aiToolCall.count({ where: { runId: run.id } })).toBe(0)
    expect(await prisma.aiMessage.findUniqueOrThrow({ where: { id: response.id } })).toMatchObject({
      status: AiMessageStatus.COMPLETED,
      contentText: 'fake',
      modelName: 'fake-deterministic-v1',
    })
    const terminalEvents = await prisma.aiRunEvent.findMany({
      where: { runId: run.id, eventType: 'agent.completed' },
    })
    expect(terminalEvents).toHaveLength(1)
  }, 60_000)

  it('真实 ContextBuilder 组合摘要与 owner memory，排除跨租户数据且 manifest 不复制原值', async () => {
    const prisma = app!.get(PrismaService)
    const conversations = app!.get(AgentConversationRepository)
    const messages = app!.get(AgentMessageRepository)
    const summaries = app!.get(ConversationSummaryRepository)
    const memories = app!.get(UserMemoryRepository)
    const runs = app!.get(AgentRunRepository)
    const registry = app!.get(WorkflowRegistryService)
    const builder = app!.get(ContextBuilderService)
    const now = new Date('2026-07-21T08:00:00.000Z')
    const ownerCanary = 'OWNER_MEMORY_CANARY_741'
    const otherCanary = 'OTHER_USER_CANARY_852'
    const [owner, other, prompt, workflowVersion] = await Promise.all([
      prisma.user.create({
        data: {
          account: `context_owner_${Date.now()}`,
          password: 'integration-test-only',
          nickname: 'Context Owner',
          role: UserRole.USER,
        },
      }),
      prisma.user.create({
        data: {
          account: `context_other_${Date.now()}`,
          password: 'integration-test-only',
          nickname: 'Context Other',
          role: UserRole.USER,
        },
      }),
      prisma.aiPromptVersion.findFirstOrThrow({ where: { status: 'PUBLISHED' }, orderBy: { createdAt: 'asc' } }),
      prisma.aiWorkflowVersion.findFirstOrThrow({ where: { status: 'PUBLISHED' }, orderBy: { createdAt: 'asc' } }),
    ])
    const [conversation, otherConversation] = await Promise.all([
      conversations.createConversation(owner.id, {
        clientRequestId: randomUUID(),
        title: '有界上下文集成',
        modelPolicy: AiModelPolicy.AUTO,
        preferredModel: null,
      }),
      conversations.createConversation(other.id, {
        clientRequestId: randomUUID(),
        title: '其他用户会话',
        modelPolicy: AiModelPolicy.AUTO,
        preferredModel: null,
      }),
    ])
    const first = await messages.appendMessage(owner.id, conversation.id, {
      clientRequestId: randomUUID(),
      role: AiMessageRole.USER,
      status: AiMessageStatus.COMPLETED,
      contentText: '先分析盈利质量',
      contentBlocks: [],
    })
    const priorAnswer = await messages.appendMessage(owner.id, conversation.id, {
      clientRequestId: randomUUID(),
      role: AiMessageRole.ASSISTANT,
      status: AiMessageStatus.COMPLETED,
      contentText: '历史结论仅用于摘要',
      contentBlocks: [],
      parentMessageId: first.id,
    })
    const trigger = await messages.appendMessage(owner.id, conversation.id, {
      clientRequestId: randomUUID(),
      role: AiMessageRole.USER,
      status: AiMessageStatus.COMPLETED,
      contentText: '继续分析现金流',
      contentBlocks: [],
    })
    const response = await messages.appendMessage(owner.id, conversation.id, {
      clientRequestId: randomUUID(),
      role: AiMessageRole.ASSISTANT,
      status: AiMessageStatus.PENDING,
      contentBlocks: [],
      parentMessageId: trigger.id,
    })
    const summaryText = '已分析贵州茅台盈利质量'
    const facts = [{ entity: '600519.SH', conclusion: '盈利稳定' }]
    const sourceMessageIds = [first.id, priorAnswer.id]
    const summary = await summaries.createAndAdvance(owner.id, conversation.id, {
      expectedSummaryVersion: 0,
      fromMessageId: first.id,
      throughMessageId: priorAnswer.id,
      summaryText,
      facts,
      sourceMessageIds,
      promptVersionId: prompt.id,
      modelName: 'fake-summary-model',
      sourceTokenCount: 128,
      contentHash: createHash('sha256').update(canonicalJson({ facts, sourceMessageIds, summaryText })).digest('hex'),
    })
    const ownerMemory = await memories.createConfirmed(owner.id, {
      category: AiMemoryCategory.CONSTRAINT,
      key: 'research.risk_limit',
      value: { note: ownerCanary, maxDrawdown: 0.15 },
      sensitivity: AiMemorySensitivity.NORMAL,
      topic: 'GENERAL',
      source: 'USER_COMMAND',
      confirmedByUser: true,
      now,
    })
    const otherMemory = await memories.createConfirmed(other.id, {
      category: AiMemoryCategory.CONSTRAINT,
      key: 'research.private_other',
      value: { note: otherCanary },
      sensitivity: AiMemorySensitivity.NORMAL,
      sourceConversationId: otherConversation.id,
      topic: 'GENERAL',
      source: 'USER_COMMAND',
      confirmedByUser: true,
      now,
    })
    const createdRun = await runs.createRun({
      userId: owner.id,
      conversationId: conversation.id,
      triggerMessageId: trigger.id,
      responseMessageId: response.id,
      clientRequestId: randomUUID(),
      traceId: `trace_${randomUUID()}`,
      workflowVersionId: workflowVersion.id,
      promptVersionId: prompt.id,
      toolPolicyVersion: 'tool-policy-v1',
      modelPolicy: AiModelPolicy.AUTO,
      inputSnapshot: { allowedCapabilities: ['INTERNAL_DATA'], allowedScopes: ['MARKET_DATA'] },
      budget: { maxInputTokens: 4_000 },
      maxAttempts: 3,
      deadlineAt: new Date(Date.now() + 170_000),
    })
    const workerId = `worker_${randomUUID()}`
    await runs.claimRun(createdRun.id, workerId)
    const executionRun = await runs.findForExecution(createdRun.id, workerId)

    const context = await builder.build({
      run: executionRun,
      workflow: registry.resolve('stock_research', 1),
      budget: 4_000,
      now,
    })
    const prepared = builder.prepareModelCall({
      context,
      purpose: 'PLAN',
      instruction: '生成研究计划',
      budget: 4_000,
    })

    expect(context.summary?.id).toBe(summary.id)
    expect(context.recentMessages.map((message) => message.id)).toEqual([trigger.id])
    expect(context.activeMemories.map((memory) => memory.id)).toEqual([ownerMemory.id])
    expect(JSON.stringify(prepared.messages)).toContain(ownerCanary)
    expect(JSON.stringify(prepared.messages)).not.toContain(otherCanary)
    expect(JSON.stringify(prepared.manifest)).toContain(summary.id)
    expect(JSON.stringify(prepared.manifest)).toContain(ownerMemory.id)
    expect(JSON.stringify(prepared.manifest)).not.toContain(ownerCanary)
    expect(JSON.stringify(prepared.manifest)).not.toContain(otherMemory.id)
  }, 60_000)
})

function resolveBaseDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) throw new Error('Agent workflow DB integration test 需要 DATABASE_URL 或本地 .env')
  const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(?:"([^"]+)"|([^#\r\n]+))/m)
  const databaseUrl = match?.[1] ?? match?.[2]?.trim()
  if (!databaseUrl) throw new Error('无法从 .env 解析 DATABASE_URL')
  return databaseUrl
}

function makeTemporaryDatabaseUrls(): { adminUrl: string; databaseUrl: string; databaseName: string } {
  const baseUrl = new URL(resolveBaseDatabaseUrl())
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (!localHosts.has(baseUrl.hostname) && process.env.AGENT_DB_TEST_ALLOW_REMOTE !== 'true') {
    throw new Error('Agent workflow DB integration test 默认只允许本机 PostgreSQL')
  }
  const databaseName = `quant_agent_workflow_it_${process.pid}_${Date.now()}`
  if (!/^quant_agent_workflow_it_\d+_\d+$/.test(databaseName)) throw new Error('临时数据库名称不安全')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  return { adminUrl: adminUrl.toString(), databaseUrl: databaseUrl.toString(), databaseName }
}

jest.setTimeout(300_000)
