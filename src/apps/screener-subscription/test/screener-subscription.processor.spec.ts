import {
  Prisma,
  SubscriptionFrequency,
  SubscriptionRuleType,
  SubscriptionRunStatus,
  SubscriptionStatus,
} from '@prisma/client'
import { Job } from 'bullmq'
import { ScreenerSubscriptionJobName } from 'src/constant/queue.constant'
import { EventsGateway } from 'src/websocket/events.gateway'
import { createMockPrismaService } from 'test/helpers/prisma-mock'
import {
  buildSubscriptionQueueJobId,
  buildSubscriptionRunKey,
  MAX_CONSECUTIVE_FAILS,
} from '../constants/subscription.constant'
import { ScreenerSubscriptionProcessor } from '../screener-subscription.processor'
import { SubscriptionEvaluatorRegistry } from '../evaluator'
import {
  CollectionTriggerPlan,
  RuleNormalizerService,
  RuleSpecValidationException,
  TriggerPlannerService,
} from '../rule'
import { SubscriptionDataReadinessService } from '../subscription-data-readiness.service'

function makeJob(name: string, data: Record<string, unknown>, id = 'job-1'): Job {
  return { id, name, data } as Job
}

function buildSub(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 10,
    name: '测试订阅',
    status: SubscriptionStatus.ACTIVE,
    filters: { minPe: 10 },
    ruleType: SubscriptionRuleType.STOCK_SCREENING,
    ruleVersion: 2,
    triggerSpec: null,
    lastEvaluatedTradeDate: '20260731',
    lastMatchCodes: ['000001.SZ'],
    consecutiveFails: 0,
    ...overrides,
  }
}

function buildPlan(overrides: Partial<CollectionTriggerPlan> = {}): CollectionTriggerPlan {
  return {
    isInitialBaseline: false,
    matchedCodes: ['000001.SZ', '000002.SZ'],
    observedEnterCodes: ['000002.SZ'],
    observedExitCodes: [],
    enterCodes: ['000002.SZ'],
    exitCodes: [],
    hits: [{ tsCode: '000002.SZ', kind: 'ENTER' }],
    ...overrides,
  }
}

describe('ScreenerSubscriptionProcessor', () => {
  let processor: ScreenerSubscriptionProcessor
  let prisma: ReturnType<typeof createMockPrismaService>
  let stockScreener: { screenCodes: jest.Mock }
  let dataReadiness: jest.Mocked<Pick<SubscriptionDataReadinessService, 'checkRule'>>
  let evaluatorRegistry: jest.Mocked<Pick<SubscriptionEvaluatorRegistry, 'get'>>
  let eventsGateway: jest.Mocked<Pick<EventsGateway, 'emitToUser'>>
  let queue: { addBulk: jest.Mock }
  let triggerPlanner: jest.Mocked<Pick<TriggerPlannerService, 'planCollection'>>
  let ruleNormalizer: jest.Mocked<
    Pick<RuleNormalizerService, 'normalizeRuleSpec' | 'normalizeLegacyStockScreeningRule' | 'normalizeTriggerSpec'>
  >

  beforeEach(() => {
    prisma = createMockPrismaService()
    prisma.screenerSubscription.updateMany.mockResolvedValue({ count: 1 } as never)
    prisma.screenerSubscriptionLog.updateMany.mockResolvedValue({ count: 1 } as never)
    stockScreener = { screenCodes: jest.fn() }
    dataReadiness = {
      checkRule: jest.fn().mockResolvedValue({
        ready: true,
        tradeDate: '20260803',
        dataVersions: { DAILY: 'target:20260803' },
        missing: [],
      }),
    }
    eventsGateway = { emitToUser: jest.fn() }
    queue = { addBulk: jest.fn().mockResolvedValue([]) }
    triggerPlanner = { planCollection: jest.fn() }
    ruleNormalizer = {
      normalizeRuleSpec: jest.fn().mockImplementation((ruleSpec) => ruleSpec as never),
      normalizeLegacyStockScreeningRule: jest.fn().mockImplementation(
        (filters) =>
          ({
            type: SubscriptionRuleType.STOCK_SCREENING,
            version: 1,
            universe: { market: 'ALL_A', excludeSt: true, excludeBse: true, excludeSuspended: true },
            filters,
          }) as never,
      ),
      normalizeTriggerSpec: jest.fn().mockReturnValue({
        mode: 'ENTER',
        notifyOnInitialMatch: false,
        eventWindow: 'CURRENT_TRADE_DATE',
        cooldownTradingDays: 0,
        maxHitsPerNotification: 20,
      }),
    }
    const evaluator = {
      evaluate: jest.fn().mockImplementation(async (context, rule) => {
        const result = await stockScreener.screenCodes({ filters: rule.filters, tradeDate: context.tradeDate })
        return {
          asOfTradeDate: result.tradeDate,
          universeCount: result.total,
          matchedCodes: result.matchedCodes,
          dataVersions: { DAILY: `target:${result.tradeDate}` },
          warnings: [],
        }
      }),
      explain: jest.fn().mockResolvedValue([]),
    }
    evaluatorRegistry = { get: jest.fn().mockReturnValue(evaluator) }

    processor = new ScreenerSubscriptionProcessor(
      prisma as never,
      dataReadiness as never,
      eventsGateway as never,
      queue as never,
      triggerPlanner as never,
      ruleNormalizer as never,
      evaluatorRegistry as never,
    )
  })

  afterEach(() => jest.clearAllMocks())

  describe('execute_subscription', () => {
    it('后续运行仅保存和通知 ENTER 触发的差集，不泄露观察到的 EXIT', async () => {
      const sub = buildSub({ lastMatchCodes: ['000001.SZ', '000003.SZ'] })
      const runKey = buildSubscriptionRunKey(sub.id, '20260803', sub.ruleVersion)
      const plan = buildPlan({
        matchedCodes: ['000001.SZ', '000002.SZ'],
        observedEnterCodes: ['000002.SZ'],
        observedExitCodes: ['000003.SZ'],
        enterCodes: ['000002.SZ'],
        exitCodes: [],
        hits: [{ tsCode: '000002.SZ', kind: 'ENTER' }],
      })
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({ id: 100, runKey } as never)
      stockScreener.screenCodes.mockResolvedValue({
        tradeDate: '20260803',
        total: 2,
        matchedCodes: ['000001.SZ', '000002.SZ'],
      })
      triggerPlanner.planCollection.mockReturnValue(plan)

      await processor.process(
        makeJob(
          ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION,
          { subscriptionId: sub.id, tradeDate: '20260803', ruleVersion: sub.ruleVersion },
          'worker-job-9',
        ),
      )

      expect(stockScreener.screenCodes).toHaveBeenCalledWith({ filters: sub.filters, tradeDate: '20260803' })
      expect(triggerPlanner.planCollection).toHaveBeenCalledWith({
        hasBaseline: true,
        previousMatchCodes: ['000001.SZ', '000003.SZ'],
        currentMatchCodes: ['000001.SZ', '000002.SZ'],
        triggerSpec: undefined,
      })
      expect(prisma.screenerSubscriptionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: sub.id,
            runKey,
            jobId: 'worker-job-9',
            tradeDate: '20260803',
            ruleVersion: sub.ruleVersion,
            status: SubscriptionRunStatus.RUNNING,
          }),
        }),
      )
      expect(prisma.screenerSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: sub.id,
            ruleVersion: sub.ruleVersion,
            status: SubscriptionStatus.ACTIVE,
          }),
          data: expect.objectContaining({
            lastEvaluatedTradeDate: '20260803',
            lastMatchCodes: ['000001.SZ', '000002.SZ'],
            consecutiveFails: 0,
            lastRunResult: expect.objectContaining({
              tradeDate: '20260803',
              matchCount: 2,
              newEntryCount: 1,
              exitCount: 0,
              runKey,
              ruleVersion: sub.ruleVersion,
            }),
          }),
        }),
      )
      expect(prisma.screenerSubscriptionLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 100, status: SubscriptionRunStatus.RUNNING }),
          data: expect.objectContaining({
            status: SubscriptionRunStatus.SUCCESS,
            matchCount: 2,
            triggerCount: 1,
            newEntryCodes: ['000002.SZ'],
            exitCount: 0,
            exitCodes: [],
            dataVersions: expect.objectContaining({ screenedAsOfTradeDate: '20260803' }),
          }),
        }),
      )
      expect(prisma.screenerSubscriptionHit.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              subscriptionId: sub.id,
              logId: 100,
              tradeDate: '20260803',
              tsCode: '000002.SZ',
              kind: 'ENTER',
              evidence: expect.objectContaining({ reason: '股票新进入基础选股结果集' }),
            }),
          ],
          skipDuplicates: true,
        }),
      )
      expect(eventsGateway.emitToUser).toHaveBeenCalledWith(
        sub.userId,
        'screener_subscription_alert',
        expect.objectContaining({
          subscriptionId: sub.id,
          tradeDate: '20260803',
          newEntryCodes: ['000002.SZ'],
          exitCodes: [],
          totalMatch: 2,
        }),
      )
    })

    it('首次成功只建立完整基线，不产生 ENTER 或通知', async () => {
      const sub = buildSub({ lastEvaluatedTradeDate: null, lastMatchCodes: [] })
      const runKey = buildSubscriptionRunKey(sub.id, '20260803', sub.ruleVersion)
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({ id: 101, runKey } as never)
      stockScreener.screenCodes.mockResolvedValue({
        tradeDate: '20260803',
        total: 2,
        matchedCodes: ['000001.SZ', '000002.SZ'],
      })
      triggerPlanner.planCollection.mockReturnValue(
        buildPlan({
          isInitialBaseline: true,
          matchedCodes: ['000001.SZ', '000002.SZ'],
          observedEnterCodes: ['000001.SZ', '000002.SZ'],
          observedExitCodes: [],
          enterCodes: [],
          exitCodes: [],
          hits: [],
        }),
      )

      await processor.process(
        makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
          subscriptionId: sub.id,
          tradeDate: '20260803',
          ruleVersion: sub.ruleVersion,
        }),
      )

      expect(triggerPlanner.planCollection).toHaveBeenCalledWith(
        expect.objectContaining({ hasBaseline: false, currentMatchCodes: ['000001.SZ', '000002.SZ'] }),
      )
      expect(prisma.screenerSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastMatchCodes: ['000001.SZ', '000002.SZ'],
            lastRunResult: expect.objectContaining({ newEntryCount: 0, exitCount: 0 }),
          }),
        }),
      )
      expect(prisma.screenerSubscriptionLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SubscriptionRunStatus.SUCCESS,
            triggerCount: 0,
            newEntryCodes: [],
            exitCodes: [],
          }),
        }),
      )
      expect(eventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('数据未就绪时标记为 skipped 并交给 BullMQ 重试，不执行筛选或累计业务失败', async () => {
      const sub = buildSub()
      const runKey = buildSubscriptionRunKey(sub.id, '20260803', sub.ruleVersion)
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({ id: 107, runKey } as never)
      dataReadiness.checkRule.mockResolvedValue({
        ready: false,
        tradeDate: '20260803',
        dataVersions: { DAILY: 'target:20260803:coverage:4990/5000' },
        missing: ['DAILY_NOT_READY'],
      })

      await expect(
        processor.process(
          makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
            subscriptionId: sub.id,
            tradeDate: '20260803',
            ruleVersion: sub.ruleVersion,
          }),
        ),
      ).rejects.toThrow('Subscription data is not ready: DAILY_NOT_READY')

      expect(stockScreener.screenCodes).not.toHaveBeenCalled()
      expect(triggerPlanner.planCollection).not.toHaveBeenCalled()
      expect(prisma.screenerSubscription.updateMany).toHaveBeenCalledTimes(1)
      expect(prisma.screenerSubscriptionLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 107, status: SubscriptionRunStatus.RUNNING }),
          data: expect.objectContaining({
            status: SubscriptionRunStatus.SKIPPED_DATA_NOT_READY,
            errorCode: 'DATA_NOT_READY',
            dataVersions: { DAILY: 'target:20260803:coverage:4990/5000' },
          }),
        }),
      )
    })

    it('不截断超过 500 个匹配，完整集合交给 planner 并持久化', async () => {
      const fullCodes = Array.from({ length: 501 }, (_, index) => `${String(index + 1).padStart(6, '0')}.SZ`)
      const sub = buildSub({ lastMatchCodes: fullCodes.slice(0, 500) })
      const runKey = buildSubscriptionRunKey(sub.id, '20260803', sub.ruleVersion)
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({ id: 102, runKey } as never)
      stockScreener.screenCodes.mockResolvedValue({ tradeDate: '20260803', total: 501, matchedCodes: fullCodes })
      triggerPlanner.planCollection.mockReturnValue(
        buildPlan({
          matchedCodes: fullCodes,
          observedEnterCodes: [fullCodes[500]],
          observedExitCodes: [],
          enterCodes: [fullCodes[500]],
          exitCodes: [],
          hits: [{ tsCode: fullCodes[500], kind: 'ENTER' }],
        }),
      )

      await processor.process(
        makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
          subscriptionId: sub.id,
          tradeDate: '20260803',
          ruleVersion: sub.ruleVersion,
        }),
      )

      expect(triggerPlanner.planCollection).toHaveBeenCalledWith(
        expect.objectContaining({ currentMatchCodes: fullCodes }),
      )
      expect(prisma.screenerSubscription.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastMatchCodes: fullCodes,
            lastRunResult: expect.objectContaining({ matchCount: 501, newEntryCount: 1, exitCount: 0 }),
          }),
        }),
      )
    })

    it('过期 ruleVersion job 直接返回，不领取 run 或评估', async () => {
      const sub = buildSub({ ruleVersion: 3 })
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)

      await processor.process(
        makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
          subscriptionId: sub.id,
          tradeDate: '20260803',
          ruleVersion: 2,
        }),
      )

      expect(prisma.screenerSubscriptionLog.findUnique).not.toHaveBeenCalled()
      expect(prisma.screenerSubscriptionLog.create).not.toHaveBeenCalled()
      expect(stockScreener.screenCodes).not.toHaveBeenCalled()
      expect(triggerPlanner.planCollection).not.toHaveBeenCalled()
    })

    it('交易日不晚于已成功基线时直接跳过，防止旧 job 覆盖新结果', async () => {
      const sub = buildSub({ lastEvaluatedTradeDate: '20260803' })
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)

      await processor.process(
        makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
          subscriptionId: sub.id,
          tradeDate: '20260803',
          ruleVersion: sub.ruleVersion,
        }),
      )

      expect(prisma.screenerSubscriptionLog.findUnique).not.toHaveBeenCalled()
      expect(stockScreener.screenCodes).not.toHaveBeenCalled()
      expect(triggerPlanner.planCollection).not.toHaveBeenCalled()
      expect(prisma.screenerSubscription.updateMany).not.toHaveBeenCalled()
    })

    it('提交时被同规则版本的更新交易日抢先覆盖，记录 superseded warning 且不通知', async () => {
      const sub = buildSub({ lastEvaluatedTradeDate: '20260801' })
      const runKey = buildSubscriptionRunKey(sub.id, '20260803', sub.ruleVersion)
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({ id: 103, runKey } as never)
      prisma.screenerSubscription.updateMany
        .mockResolvedValueOnce({ count: 1 } as never)
        .mockResolvedValueOnce({ count: 0 } as never)
      stockScreener.screenCodes.mockResolvedValue({
        tradeDate: '20260803',
        total: 2,
        matchedCodes: ['000001.SZ', '000002.SZ'],
      })
      triggerPlanner.planCollection.mockReturnValue(buildPlan())

      await processor.process(
        makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
          subscriptionId: sub.id,
          tradeDate: '20260803',
          ruleVersion: sub.ruleVersion,
        }),
      )

      expect(prisma.screenerSubscriptionLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 103, status: SubscriptionRunStatus.SUCCESS }),
          data: expect.objectContaining({
            warningCount: 1,
            errorCode: 'STALE_RUN_SUPERSEDED',
          }),
        }),
      )
      expect(eventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('同一 runKey 已成功时不重新评估或重复通知', async () => {
      const sub = buildSub()
      const runKey = buildSubscriptionRunKey(sub.id, '20260803', sub.ruleVersion)
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscriptionLog.findUnique.mockResolvedValue({
        id: 103,
        runKey,
        status: SubscriptionRunStatus.SUCCESS,
      } as never)

      await processor.process(
        makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
          subscriptionId: sub.id,
          tradeDate: '20260803',
          ruleVersion: sub.ruleVersion,
        }),
      )

      expect(prisma.screenerSubscriptionLog.create).not.toHaveBeenCalled()
      expect(prisma.screenerSubscriptionLog.updateMany).not.toHaveBeenCalled()
      expect(stockScreener.screenCodes).not.toHaveBeenCalled()
      expect(eventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('已有新鲜 RUNNING run 时拒绝 job 重试，不改写 run 或累计业务失败', async () => {
      const sub = buildSub()
      const runKey = buildSubscriptionRunKey(sub.id, '20260803', sub.ruleVersion)
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscriptionLog.findUnique.mockResolvedValue({
        id: 104,
        runKey,
        status: SubscriptionRunStatus.RUNNING,
      } as never)
      prisma.screenerSubscriptionLog.updateMany.mockResolvedValue({ count: 0 } as never)

      await expect(
        processor.process(
          makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
            subscriptionId: sub.id,
            tradeDate: '20260803',
            ruleVersion: sub.ruleVersion,
          }),
        ),
      ).rejects.toThrow(`Subscription run ${runKey} is already in progress`)

      expect(prisma.screenerSubscriptionLog.create).not.toHaveBeenCalled()
      expect(prisma.screenerSubscription.updateMany).toHaveBeenCalledTimes(1)
      expect(prisma.screenerSubscriptionLog.update).not.toHaveBeenCalled()
      expect(stockScreener.screenCodes).not.toHaveBeenCalled()
      expect(eventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('并发创建同一 runKey 的唯一冲突会拒绝 job 重试，不误标记为完成', async () => {
      const sub = buildSub()
      const runKey = buildSubscriptionRunKey(sub.id, '20260803', sub.ruleVersion)
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscriptionLog.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 104, runKey, status: SubscriptionRunStatus.RUNNING } as never)
      prisma.screenerSubscriptionLog.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate run key', { code: 'P2002', clientVersion: 'test' }),
      )

      await expect(
        processor.process(
          makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
            subscriptionId: sub.id,
            tradeDate: '20260803',
            ruleVersion: sub.ruleVersion,
          }),
        ),
      ).rejects.toThrow(`Subscription run ${runKey} is already in progress`)

      expect(stockScreener.screenCodes).not.toHaveBeenCalled()
      expect(prisma.screenerSubscription.updateMany).toHaveBeenCalledTimes(1)
      expect(prisma.screenerSubscriptionLog.update).not.toHaveBeenCalled()
      expect(eventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('失败 run 由原子 updateMany 重新领取后可重试', async () => {
      const sub = buildSub()
      const runKey = buildSubscriptionRunKey(sub.id, '20260803', sub.ruleVersion)
      prisma.screenerSubscription.findUnique.mockResolvedValue(sub as never)
      prisma.screenerSubscriptionLog.findUnique.mockResolvedValue({
        id: 104,
        runKey,
        status: SubscriptionRunStatus.FAILED,
      } as never)
      prisma.screenerSubscriptionLog.updateMany.mockResolvedValue({ count: 1 } as never)
      stockScreener.screenCodes.mockResolvedValue({
        tradeDate: '20260803',
        total: 2,
        matchedCodes: ['000001.SZ', '000002.SZ'],
      })
      triggerPlanner.planCollection.mockReturnValue(buildPlan())

      await processor.process(
        makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
          subscriptionId: sub.id,
          tradeDate: '20260803',
          ruleVersion: sub.ruleVersion,
        }),
      )

      expect(prisma.screenerSubscriptionLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 104 }),
          data: expect.objectContaining({ status: SubscriptionRunStatus.RUNNING }),
        }),
      )
      expect(prisma.screenerSubscriptionLog.create).not.toHaveBeenCalled()
      expect(stockScreener.screenCodes).toHaveBeenCalledTimes(1)
    })

    it('规则校验失败写入 RULE_INVALID、递增失败并抛给 BullMQ 重试', async () => {
      const sub = buildSub({ consecutiveFails: 1 })
      const runKey = buildSubscriptionRunKey(sub.id, '20260803', sub.ruleVersion)
      prisma.screenerSubscription.findUnique
        .mockResolvedValueOnce(sub as never)
        .mockResolvedValueOnce({ consecutiveFails: 2 } as never)
      prisma.screenerSubscription.updateMany
        .mockResolvedValueOnce({ count: 1 } as never)
        .mockResolvedValueOnce({ count: 0 } as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({ id: 105, runKey } as never)
      stockScreener.screenCodes.mockResolvedValue({ tradeDate: '20260803', total: 1, matchedCodes: ['000001.SZ'] })
      triggerPlanner.planCollection.mockImplementation(() => {
        throw new RuleSpecValidationException([
          { code: 'TRIGGER_MODE_INVALID', path: '$.triggerSpec.mode', message: 'mode 无效' },
        ])
      })

      await expect(
        processor.process(
          makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
            subscriptionId: sub.id,
            tradeDate: '20260803',
            ruleVersion: sub.ruleVersion,
          }),
        ),
      ).rejects.toMatchObject({ code: 'RULE_INVALID', message: '订阅规则无效' })

      expect(prisma.screenerSubscription.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            id: sub.id,
            ruleVersion: sub.ruleVersion,
            status: SubscriptionStatus.ACTIVE,
          }),
          data: { consecutiveFails: { increment: 1 } },
        }),
      )
      expect(prisma.screenerSubscriptionLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 105, status: SubscriptionRunStatus.RUNNING }),
          data: expect.objectContaining({
            status: SubscriptionRunStatus.FAILED,
            errorCode: 'RULE_INVALID',
            errorMessage: '订阅规则无效',
          }),
        }),
      )
      expect(eventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it(`第 ${MAX_CONSECUTIVE_FAILS} 次评估失败转 ERROR，写 EVALUATION_FAILED 并通知一次`, async () => {
      const sub = buildSub({ consecutiveFails: MAX_CONSECUTIVE_FAILS - 1 })
      const runKey = buildSubscriptionRunKey(sub.id, '20260803', sub.ruleVersion)
      prisma.screenerSubscription.findUnique
        .mockResolvedValueOnce(sub as never)
        .mockResolvedValueOnce({ consecutiveFails: MAX_CONSECUTIVE_FAILS } as never)
      prisma.screenerSubscription.updateMany
        .mockResolvedValueOnce({ count: 1 } as never)
        .mockResolvedValueOnce({ count: 1 } as never)
      prisma.screenerSubscriptionLog.create.mockResolvedValue({ id: 106, runKey } as never)
      stockScreener.screenCodes.mockRejectedValue(new Error('database detail must not leak'))

      await expect(
        processor.process(
          makeJob(ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION, {
            subscriptionId: sub.id,
            tradeDate: '20260803',
            ruleVersion: sub.ruleVersion,
          }),
        ),
      ).rejects.toMatchObject({ code: 'EVALUATION_FAILED', message: '订阅规则执行失败' })

      expect(prisma.screenerSubscription.updateMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ data: { consecutiveFails: { increment: 1 } } }),
      )
      expect(prisma.screenerSubscription.updateMany).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          where: expect.objectContaining({ consecutiveFails: { gte: MAX_CONSECUTIVE_FAILS } }),
          data: { status: SubscriptionStatus.ERROR },
        }),
      )
      expect(prisma.screenerSubscriptionLog.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SubscriptionRunStatus.FAILED, errorCode: 'EVALUATION_FAILED' }),
        }),
      )
      expect(eventsGateway.emitToUser).toHaveBeenCalledWith(
        sub.userId,
        'screener_subscription_failed',
        expect.objectContaining({
          subscriptionId: sub.id,
          tradeDate: '20260803',
          errorCode: 'EVALUATION_FAILED',
          error: '订阅规则执行失败',
          consecutiveFails: MAX_CONSECUTIVE_FAILS,
        }),
      )
    })
  })

  describe('batch_execute', () => {
    it('按页只 fan-out 单订阅 job，携带规则版本与 BullMQ retry 策略', async () => {
      prisma.screenerSubscription.findMany
        .mockResolvedValueOnce([
          { id: 1, ruleVersion: 2 },
          { id: 2, ruleVersion: 4 },
        ] as never)
        .mockResolvedValueOnce([{ id: 3, ruleVersion: 1 }] as never)
        .mockResolvedValueOnce([] as never)

      await processor.process(
        makeJob(ScreenerSubscriptionJobName.BATCH_EXECUTE, {
          frequency: SubscriptionFrequency.DAILY,
          tradeDate: '20260803',
        }),
      )

      expect(prisma.screenerSubscription.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { status: SubscriptionStatus.ACTIVE, frequency: SubscriptionFrequency.DAILY },
          select: { id: true, ruleVersion: true },
          orderBy: { id: 'asc' },
          take: 100,
        }),
      )
      expect(prisma.screenerSubscription.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ cursor: { id: 2 }, skip: 1 }),
      )
      expect(queue.addBulk).toHaveBeenNthCalledWith(1, [
        expect.objectContaining({
          name: ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION,
          data: {
            subscriptionId: 1,
            tradeDate: '20260803',
            ruleVersion: 2,
            expectedFrequency: SubscriptionFrequency.DAILY,
          },
          opts: {
            jobId: buildSubscriptionQueueJobId(1, '20260803', 2),
            attempts: MAX_CONSECUTIVE_FAILS + 1,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: 50,
            removeOnFail: true,
          },
        }),
        expect.objectContaining({
          data: {
            subscriptionId: 2,
            tradeDate: '20260803',
            ruleVersion: 4,
            expectedFrequency: SubscriptionFrequency.DAILY,
          },
          opts: expect.objectContaining({ jobId: buildSubscriptionQueueJobId(2, '20260803', 4) }),
        }),
      ])
      expect(queue.addBulk).toHaveBeenNthCalledWith(2, [
        expect.objectContaining({
          data: {
            subscriptionId: 3,
            tradeDate: '20260803',
            ruleVersion: 1,
            expectedFrequency: SubscriptionFrequency.DAILY,
          },
          opts: expect.objectContaining({ jobId: buildSubscriptionQueueJobId(3, '20260803', 1) }),
        }),
      ])
      expect(stockScreener.screenCodes).not.toHaveBeenCalled()
    })

    it('无活跃订阅时不创建队列 job', async () => {
      prisma.screenerSubscription.findMany.mockResolvedValue([] as never)

      await processor.process(
        makeJob(ScreenerSubscriptionJobName.BATCH_EXECUTE, {
          frequency: SubscriptionFrequency.MONTHLY,
          tradeDate: '20260831',
        }),
      )

      expect(queue.addBulk).not.toHaveBeenCalled()
      expect(stockScreener.screenCodes).not.toHaveBeenCalled()
    })
  })

  it('未知 job 直接返回，不评估或入队', async () => {
    await expect(processor.process(makeJob('unknown', {}))).resolves.toBeUndefined()

    expect(stockScreener.screenCodes).not.toHaveBeenCalled()
    expect(queue.addBulk).not.toHaveBeenCalled()
  })
})
