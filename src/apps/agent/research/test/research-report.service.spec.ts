import { AiAgentRunStatus, AiMessageStatus, AiResearchReportStatus } from '@prisma/client'
import { MESSAGE_BLOCK_FIXTURES } from 'src/apps/agent/contracts'
import { ResearchReportService } from '../research-report.service'

type StoredReport = Record<string, unknown>

describe('ResearchReportService', () => {
  it('RPT-BIZ-001: preview 不写入；同一确认幂等只创建一份绑定 Run/消息版本的报告', async () => {
    const harness = createHarness()

    const preview = await harness.service.save(7, { runId: 'run_1' })

    expect(preview.requiresConfirmation).toBe(true)
    expect(harness.reports).toHaveLength(0)
    expect(preview.preview?.dataAsOf).toBe('2026-07-22')
    expect(preview.preview?.citations).toHaveLength(1)

    const confirmation = await harness.service.save(7, {
      confirmationToken: preview.confirmationToken,
      clientRequestId: 'save-report-1',
    })
    const repeated = await harness.service.save(7, {
      confirmationToken: preview.confirmationToken,
      clientRequestId: 'save-report-1',
    })

    expect(confirmation.requiresConfirmation).toBe(false)
    expect(confirmation.report?.status).toBe(AiResearchReportStatus.QUEUED)
    expect(repeated.report?.reportId).toBe(confirmation.report?.reportId)
    expect(harness.reports).toHaveLength(1)
    expect(harness.queue.enqueueRender).toHaveBeenCalledTimes(1)
  })

  it('RPT-SEC-001: 确认 token 绑定 owner 和消息版本，跨租户或 Run 重生成均拒绝', async () => {
    const harness = createHarness()
    const preview = await harness.service.save(7, { runId: 'run_1' })

    await expect(
      harness.service.save(8, { confirmationToken: preview.confirmationToken, clientRequestId: 'other-user' }),
    ).rejects.toMatchObject({ definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_CONFIRMATION_INVALID' }) })

    harness.run.responseMessage.version = 2
    await expect(
      harness.service.save(7, { confirmationToken: preview.confirmationToken, clientRequestId: 'changed-message' }),
    ).rejects.toMatchObject({ definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_CONFIRMATION_INVALID' }) })
    expect(harness.reports).toHaveLength(0)
  })

  it('RPT-VAL-001: 研究无可追溯引用时不能进入确认阶段', async () => {
    const harness = createHarness()
    harness.run.responseMessage.citations = []

    await expect(harness.service.save(7, { runId: 'run_1' })).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_CITATION_INVALID' }),
    })
    expect(harness.reports).toHaveLength(0)
  })

  it('RPT-BIZ-002: 报告详情返回保存时冻结的正文块、引用与来源 manifest，不读取后续 Run 改写', async () => {
    const harness = createHarness()
    const preview = await harness.service.save(7, { runId: 'run_1' })
    const saved = await harness.service.save(7, {
      confirmationToken: preview.confirmationToken,
      clientRequestId: 'frozen-detail-report',
    })

    harness.run.responseMessage.contentText = 'Run 后续版本内容，不应覆盖已保存报告'
    const detail = await harness.service.detail(7, saved.report!.reportId)

    expect(detail).toMatchObject({
      messageVersion: 1,
      contentText: '贵州茅台估值与风险研究\n结论：关注估值和需求变化。',
      contentBlocks: [expect.objectContaining({ type: 'MARKDOWN' })],
      citations: [
        expect.objectContaining({
          citationId: 'citation_1',
          title: '上市公司公告',
          locator: { section: '经营数据' },
        }),
      ],
      manifest: expect.objectContaining({
        sourceRunId: 'run_1',
        messageId: 'message_1',
        messageVersion: 1,
      }),
    })
  })

  it('RPT-ASYNC-001: worker 只渲染 queued 报告，安全转义正文后写入受管对象并标记 COMPLETED', async () => {
    const harness = createHarness()
    const report: StoredReport = {
      id: 'report_1',
      userId: 7,
      status: AiResearchReportStatus.QUEUED,
      deletedAt: null,
      title: '研究 <script>alert(1)</script>',
      summary: '可复盘结论',
      contentText: '<img src=x onerror=alert(1)>',
      contentBlocks: [],
      citationManifest: [{ title: '官方来源', canonicalUrl: 'https://example.com/source' }],
      dataAsOf: new Date('2026-07-22T00:00:00.000Z'),
      contentHash: 'a'.repeat(64),
    }
    harness.reports.push(report)

    const result = await harness.service.render('report_1')

    expect(result).toBe('COMPLETED')
    expect(report.status).toBe(AiResearchReportStatus.COMPLETED)
    expect(harness.storage.put).toHaveBeenCalledTimes(1)
    const storedBody = (harness.storage.put.mock.calls[0][1] as Buffer).toString('utf8')
    expect(storedBody).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(storedBody).not.toContain('<img src=x onerror=alert(1)>')
  })
})

function createHarness() {
  const reports: StoredReport[] = []
  const run = {
    id: 'run_1',
    userId: 7,
    conversationId: 'conversation_1',
    status: AiAgentRunStatus.COMPLETED,
    conversation: { title: '贵州茅台研究' },
    responseMessage: {
      id: 'message_1',
      status: AiMessageStatus.COMPLETED,
      version: 1,
      contentText: '贵州茅台估值与风险研究\n结论：关注估值和需求变化。',
      contentBlocks: [MESSAGE_BLOCK_FIXTURES[0]],
      citations: [
        {
          publicId: 'citation_1',
          blockId: 'block_markdown_1',
          claimKey: 'valuation',
          conclusionLevel: 'FACT',
          sourceType: 'OFFICIAL',
          sourceTitle: '上市公司公告',
          canonicalUrl: 'https://example.com/announcement',
          publisher: '交易所',
          retrievedAt: new Date('2026-07-22T10:00:00.000Z'),
          contentHash: 'b'.repeat(64),
          locator: { section: '经营数据' },
        },
      ],
    },
    toolCalls: [{ dataThrough: new Date('2026-07-22T00:00:00.000Z') }],
  }
  const aiResearchReport = {
    findUnique: jest.fn(async (input: { where: Record<string, unknown> }) => {
      const key = input.where.userId_clientRequestId as { userId: number; clientRequestId: string } | undefined
      if (key) {
        return (
          reports.find((report) => report.userId === key.userId && report.clientRequestId === key.clientRequestId) ??
          null
        )
      }
      const id = input.where.id
      return reports.find((report) => report.id === id) ?? null
    }),
    findUniqueOrThrow: jest.fn(async (input: { where: { id: string } }) => {
      const report = reports.find((candidate) => candidate.id === input.where.id)
      if (!report) throw new Error('missing report')
      return report
    }),
    findFirst: jest.fn(async (input: { where: Record<string, unknown> }) => {
      const report = reports.find((candidate) => {
        if (candidate.id !== input.where.id) return false
        if (input.where.userId !== undefined && candidate.userId !== input.where.userId) return false
        if (input.where.status !== undefined && candidate.status !== input.where.status) return false
        if (input.where.deletedAt !== undefined && candidate.deletedAt !== input.where.deletedAt) return false
        return true
      })
      return report ?? null
    }),
    create: jest.fn(async (input: { data: Record<string, unknown> }) => {
      const report: StoredReport = {
        ...input.data,
        id: `report_${reports.length + 1}`,
        status: AiResearchReportStatus.QUEUED,
        errorMessage: null,
        createdAt: new Date('2026-07-22T11:00:00.000Z'),
        renderedAt: null,
        deletedAt: null,
      }
      reports.push(report)
      return report
    }),
    updateMany: jest.fn(async (input: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const report = reports.find((candidate) => {
        if (candidate.id !== input.where.id) return false
        if (input.where.status !== undefined && candidate.status !== input.where.status) return false
        if (input.where.deletedAt === null && candidate.deletedAt !== null) return false
        return true
      })
      if (!report) return { count: 0 }
      for (const [key, value] of Object.entries(input.data)) {
        if (value && typeof value === 'object' && 'increment' in value) {
          report[key] = Number(report[key] ?? 0) + Number((value as { increment: number }).increment)
        } else {
          report[key] = value
        }
      }
      return { count: 1 }
    }),
    update: jest.fn(async (input: { where: { id: string }; data: Record<string, unknown> }) => {
      const report = reports.find((candidate) => candidate.id === input.where.id)
      if (!report) throw new Error('missing report')
      Object.assign(report, input.data)
      return report
    }),
    findMany: jest.fn(async () => []),
  }
  const prisma = {
    aiAgentRun: { findFirst: jest.fn(async () => run) },
    aiResearchReport,
    $transaction: jest.fn(
      async (operation: (transaction: { aiResearchReport: typeof aiResearchReport }) => Promise<unknown>) =>
        operation({ aiResearchReport }),
    ),
  }
  const queue = { enqueueRender: jest.fn(async () => undefined), enqueueCleanup: jest.fn(async () => undefined) }
  const storage = {
    put: jest.fn(async (key: string, content: Buffer) => ({ key, hash: 'c'.repeat(64), size: content.byteLength })),
    get: jest.fn(),
    delete: jest.fn(async () => undefined),
  }
  const service = new ResearchReportService(
    prisma as never,
    { createForResearchReport: jest.fn() } as never,
    queue as never,
    storage as never,
    {
      confirmationSecret: 'test-report-confirmation-secret-at-least-32-characters',
      confirmationTtlSeconds: 600,
      reconcileBatchSize: 50,
    } as never,
    { warn: jest.fn(), log: jest.fn() } as never,
  )
  return { service, run, reports, queue, storage }
}
