import { createHmac } from 'node:crypto'
import { AiAgentRunStatus, AiMessageStatus, AiResearchReportStatus, Prisma } from '@prisma/client'
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

  it('AGT2-ERR-002: 缺失/非法 Run、非完成回答、非法消息块和空内容均不能进入预览', async () => {
    await expect(createHarness().service.save(7, {})).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_INVALID' }),
    })
    await expect(createHarness().service.save(7, { runId: 'bad run id' })).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_INVALID' }),
    })

    const missingRun = createHarness()
    missingRun.prisma.aiAgentRun.findFirst.mockResolvedValueOnce(null as never)
    await expect(missingRun.service.save(7, { runId: 'run_1' })).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_INVALID' }),
    })

    const incomplete = createHarness()
    incomplete.run.responseMessage.status = AiMessageStatus.FAILED as never
    await expect(incomplete.service.save(7, { runId: 'run_1' })).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_INVALID' }),
    })

    const invalidBlocks = createHarness()
    invalidBlocks.run.responseMessage.contentBlocks = [{ type: 'UNKNOWN' }] as never
    await expect(invalidBlocks.service.save(7, { runId: 'run_1' })).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_INVALID' }),
    })

    const empty = createHarness()
    empty.run.responseMessage.contentText = '   '
    empty.run.responseMessage.contentBlocks = []
    await expect(empty.service.save(7, { runId: 'run_1' })).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_INVALID' }),
    })
  })

  it('AGT2-SEC-001: 确认 token 的签名、字段、过期时间和 clientRequestId 全部 fail-closed', async () => {
    const harness = createHarness()
    const preview = await harness.service.save(7, { runId: 'run_1' })

    await expect(harness.service.save(7, { confirmationToken: 'missing-signature' })).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_INVALID' }),
    })
    await expect(
      harness.service.save(7, { confirmationToken: `${preview.confirmationToken}.extra`, clientRequestId: 'extra' }),
    ).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_CONFIRMATION_INVALID' }),
    })
    await expect(
      harness.service.save(7, {
        confirmationToken: `${preview.confirmationToken!.slice(0, -1)}x`,
        clientRequestId: 'tampered',
      }),
    ).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_CONFIRMATION_INVALID' }),
    })
    await expect(
      harness.service.save(7, { confirmationToken: preview.confirmationToken, clientRequestId: 'x'.repeat(129) }),
    ).rejects.toMatchObject({ definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_INVALID' }) })

    const invalidClaims: Array<(claims: Record<string, unknown>) => void> = [
      (claims) => (claims.userId = 7.5),
      (claims) => (claims.runId = 'bad run'),
      (claims) => (claims.messageId = ''),
      (claims) => (claims.messageVersion = 1.5),
      (claims) => (claims.contentHash = 'not-a-hash'),
      (claims) => (claims.journalHash = 'not-a-hash'),
      (claims) => (claims.expiresAt = 0),
    ]
    for (const mutate of invalidClaims) {
      await expect(
        harness.service.save(7, {
          confirmationToken: mutateConfirmationToken(preview.confirmationToken!, mutate),
          clientRequestId: `invalid-claim-${invalidClaims.indexOf(mutate)}`,
        }),
      ).rejects.toMatchObject({
        definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_CONFIRMATION_INVALID' }),
      })
    }
    expect(harness.reports).toHaveLength(0)
  })

  it('AGT2-DATA-002: 结构化报告保留 null 数据日期，并规范化投资日志去重风险项', async () => {
    const harness = createHarness()
    harness.run.responseMessage.contentText = null
    harness.run.conversation.title = ''
    harness.run.toolCalls = [{ dataThrough: null }, { dataThrough: null }]
    const journal = {
      tsCode: '600519.SH',
      thesis: '  长期需求稳定  ',
      risks: [' 需求波动 ', '需求波动', '  '],
      reviewAt: '2026-12-31T08:00:00.000Z',
    }

    const preview = await harness.service.save(7, { runId: 'run_1', journal })
    expect(preview.preview).toMatchObject({
      title: 'Agent 研究报告',
      summary: '研究结果包含结构化内容，请在报告详情查看。',
      dataAsOf: null,
    })

    const saved = await harness.service.save(7, {
      confirmationToken: preview.confirmationToken,
      clientRequestId: 'journal-report',
      journal,
    })
    expect(saved.report?.journalId).toBe(501)
    expect(harness.journals.createForResearchReport).toHaveBeenCalledWith(
      expect.anything(),
      7,
      'run_1',
      saved.report?.reportId,
      expect.objectContaining({
        tsCode: '600519.SH',
        thesis: '长期需求稳定',
        risks: ['需求波动'],
        reviewAt: new Date('2026-12-31T08:00:00.000Z'),
      }),
    )
  })

  it.each([
    [{ tsCode: '600519' }, '股票代码'],
    [{ reviewAt: 'not-a-date' }, '复盘时间'],
    [{ thesis: 'x'.repeat(4_001) }, undefined],
  ])('AGT2-EDGE-003: 非法投资日志字段被拒绝 %#', async (journal, message) => {
    const promise = createHarness().service.save(7, { runId: 'run_1', journal })
    await expect(promise).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_INVALID' }),
      ...(message ? { message: expect.stringContaining(message) } : {}),
    })
  })

  it('AGT2-BIZ-002: 列表分页、状态筛选、详情不存在和 owner 隔离保持稳定', async () => {
    const harness = createHarness()
    const first = reportFixture({ id: 'report_3', journal: { id: 33 } })
    const second = reportFixture({ id: 'report_2', journal: null })
    const overflow = reportFixture({ id: 'report_1' })
    harness.aiResearchReport.findMany.mockResolvedValueOnce([first, second, overflow] as never)

    const page = await harness.service.list(7, {
      limit: 2,
      cursor: 'report_4',
      status: AiResearchReportStatus.COMPLETED,
    })
    expect(page.items.map((item) => item.reportId)).toEqual(['report_3', 'report_2'])
    expect(page.items.map((item) => item.journalId)).toEqual([33, null])
    expect(page.nextCursor).toBe('report_2')
    expect(harness.aiResearchReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 7,
          status: AiResearchReportStatus.COMPLETED,
          id: { lt: 'report_4' },
        }),
        take: 3,
      }),
    )

    await expect(harness.service.detail(8, 'report_3')).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_NOT_FOUND' }),
    })
  })

  it('AGT2-DATA-003: 删除使用 owner 条件和 CAS；清理入队失败不回滚删除事实', async () => {
    const missing = createHarness()
    await expect(missing.service.delete(7, 'missing')).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_NOT_FOUND' }),
    })

    const conflict = createHarness()
    conflict.reports.push(reportFixture({ id: 'report_conflict' }))
    conflict.aiResearchReport.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(conflict.service.delete(7, 'report_conflict')).rejects.toMatchObject({
      definition: expect.objectContaining({ key: 'AI_RESEARCH_REPORT_CONFLICT' }),
    })

    const harness = createHarness()
    harness.reports.push(
      reportFixture({ id: 'report_delete', storageKey: 'stored/report.html', storageDeletedAt: null }),
    )
    harness.queue.enqueueCleanup.mockRejectedValueOnce(new Error('queue offline'))
    const deleted = await harness.service.delete(7, 'report_delete')
    expect(deleted.status).toBe(AiResearchReportStatus.DELETED)
    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'agentResearchReport.enqueueCleanup', reportId: 'report_delete' }),
      ResearchReportService.name,
    )
  })

  it('AGT2-BIZ-003: reconcile 只返回可发布和待清理报告 ID', async () => {
    const harness = createHarness()
    harness.aiResearchReport.findMany
      .mockResolvedValueOnce([{ id: 'queued_1' }, { id: 'queued_2' }] as never)
      .mockResolvedValueOnce([{ id: 'deleted_1' }] as never)

    await expect(harness.service.publishableReportIds(2)).resolves.toEqual(['queued_1', 'queued_2'])
    await expect(harness.service.cleanupReportIds(1)).resolves.toEqual(['deleted_1'])
    expect(harness.aiResearchReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: AiResearchReportStatus.GENERATING }),
        data: expect.objectContaining({ status: AiResearchReportStatus.QUEUED }),
      }),
    )
  })

  it('AGT2-RACE-002: 渲染 claim 冲突、删除竞态和存储失败都产生唯一受控结果', async () => {
    await expect(createHarness().service.render('missing')).resolves.toBe('IGNORED')

    const deletedRace = createHarness()
    deletedRace.reports.push(reportFixture({ id: 'report_race', status: AiResearchReportStatus.QUEUED }))
    deletedRace.aiResearchReport.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    await expect(deletedRace.service.render('report_race')).resolves.toBe('DELETED')
    expect(deletedRace.storage.delete).toHaveBeenCalledTimes(1)

    const failed = createHarness()
    failed.reports.push(reportFixture({ id: 'report_failed', status: AiResearchReportStatus.QUEUED }))
    failed.storage.put.mockRejectedValueOnce(new Error('x'.repeat(1_200)))
    await expect(failed.service.render('report_failed')).resolves.toBe('FAILED')
    expect(failed.reports[0].errorMessage).toHaveLength(1_000)
    expect(failed.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'agentResearchReport.render', reportId: 'report_failed' }),
      ResearchReportService.name,
    )
  })

  it('AGT2-DATA-004: 对象清理幂等，失败时记录安全错误并保留重试机会', async () => {
    await expect(createHarness().service.cleanup('missing')).resolves.toBe('IGNORED')

    const cleaned = createHarness()
    cleaned.reports.push(
      reportFixture({ id: 'report_clean', status: AiResearchReportStatus.DELETED, storageKey: 'report/key.html' }),
    )
    await expect(cleaned.service.cleanup('report_clean')).resolves.toBe('CLEANED')
    expect(cleaned.storage.delete).toHaveBeenCalledWith('report/key.html')

    const failed = createHarness()
    failed.reports.push(
      reportFixture({ id: 'report_cleanup_fail', status: AiResearchReportStatus.DELETED, storageKey: 'bad/key.html' }),
    )
    failed.storage.delete.mockRejectedValueOnce('storage offline')
    await expect(failed.service.cleanup('report_cleanup_fail')).rejects.toBe('storage offline')
    expect(failed.aiResearchReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cleanupError: '报告渲染或存储失败' }),
      }),
    )
  })

  it('AGT2-DATA-005: 唯一键竞态只复用内容完全相同的冻结报告', async () => {
    const harness = createHarness()
    const preview = await harness.service.save(7, { runId: 'run_1' })
    const claims = JSON.parse(Buffer.from(preview.confirmationToken!.split('.')[0], 'base64url').toString('utf8'))
    const raced = reportFixture({
      id: 'report_raced',
      runId: 'run_1',
      messageId: 'message_1',
      contentHash: claims.contentHash,
    })
    harness.prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6.19.2' }),
    )
    harness.aiResearchReport.findFirst.mockResolvedValueOnce(raced as never)

    const saved = await harness.service.save(7, {
      confirmationToken: preview.confirmationToken,
      clientRequestId: 'raced-save',
    })
    expect(saved.report?.reportId).toBe('report_raced')
    expect(harness.queue.enqueueRender).not.toHaveBeenCalled()
  })
})

const CONFIRMATION_SECRET = 'test-report-confirmation-secret-at-least-32-characters'

function mutateConfirmationToken(token: string, mutate: (claims: Record<string, unknown>) => void): string {
  const [encoded] = token.split('.')
  const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>
  mutate(claims)
  const mutated = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = createHmac('sha256', CONFIRMATION_SECRET).update(mutated).digest('base64url')
  return `${mutated}.${signature}`
}

function reportFixture(overrides: Record<string, unknown> = {}): StoredReport {
  return {
    id: 'report_1',
    userId: 7,
    runId: 'run_1',
    conversationId: 'conversation_1',
    messageId: 'message_1',
    messageVersion: 1,
    clientRequestId: 'fixture-request',
    version: 1,
    status: AiResearchReportStatus.COMPLETED,
    title: '冻结研究报告',
    summary: '冻结摘要',
    contentText: '冻结正文',
    contentBlocks: [],
    citationManifest: [],
    manifest: {},
    contentHash: 'a'.repeat(64),
    dataAsOf: null,
    errorMessage: null,
    storageKey: null,
    storageDeletedAt: null,
    createdAt: new Date('2026-07-22T11:00:00.000Z'),
    updatedAt: new Date('2026-07-22T11:00:00.000Z'),
    renderedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

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
  const journals = { createForResearchReport: jest.fn(async () => ({ id: 501 })) }
  const logger = { warn: jest.fn(), log: jest.fn() }
  const storage = {
    put: jest.fn(async (key: string, content: Buffer) => ({ key, hash: 'c'.repeat(64), size: content.byteLength })),
    get: jest.fn(),
    delete: jest.fn(async () => undefined),
  }
  const service = new ResearchReportService(
    prisma as never,
    journals as never,
    queue as never,
    storage as never,
    {
      confirmationSecret: CONFIRMATION_SECRET,
      confirmationTtlSeconds: 600,
      reconcileBatchSize: 50,
    } as never,
    logger as never,
  )
  return { service, run, reports, queue, storage, journals, logger, prisma, aiResearchReport }
}
