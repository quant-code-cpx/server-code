import { randomUUID } from 'node:crypto'
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Prisma, SubscriptionFrequency, SubscriptionRunStatus, SubscriptionStatus } from '@prisma/client'
import { Job, Queue } from 'bullmq'
import { SCREENER_SUBSCRIPTION_QUEUE, ScreenerSubscriptionJobName } from 'src/constant/queue.constant'
import { PrismaService } from 'src/shared/prisma.service'
import { EventsGateway } from 'src/websocket/events.gateway'
import {
  buildSubscriptionQueueJobId,
  buildSubscriptionRunKey,
  MAX_CONSECUTIVE_FAILS,
} from './constants/subscription.constant'
import { RuleNormalizerService, RuleSpecValidationException, TriggerPlannerService } from './rule'
import { SubscriptionEvaluatorRegistry } from './evaluator'
import {
  SubscriptionDataReadinessResult,
  SubscriptionDataReadinessService,
} from './subscription-data-readiness.service'

interface BatchExecuteData {
  frequency: SubscriptionFrequency
  tradeDate: string
}

interface ExecuteSingleData {
  subscriptionId: number
  tradeDate: string
  ruleVersion?: number
  /** Batch 领取时的频率快照；手动执行不限制频率。 */
  expectedFrequency?: SubscriptionFrequency
  /** 数据恢复任务允许补跑已被更新交易日领取的旧 run，但不会覆写新基线。 */
  recovery?: boolean
}

interface ClaimedRun {
  id: number
  runKey: string
  attemptToken: string
  startedAt: Date
}

interface FailureRecord {
  error: SubscriptionExecutionError
  consecutiveFails: number
  transitionedToError: boolean
  ownershipLost: boolean
}

const BATCH_PAGE_SIZE = 100
const RUNNING_LEASE_MS = 2 * 60 * 1000
const JOB_RETRY_ATTEMPTS = MAX_CONSECUTIVE_FAILS + 1
const JOB_RETRY_DELAY_MS = 30_000

@Processor(SCREENER_SUBSCRIPTION_QUEUE)
export class ScreenerSubscriptionProcessor extends WorkerHost {
  private readonly logger = new Logger(ScreenerSubscriptionProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataReadiness: SubscriptionDataReadinessService,
    private readonly eventsGateway: EventsGateway,
    @InjectQueue(SCREENER_SUBSCRIPTION_QUEUE) private readonly queue: Queue,
    private readonly triggerPlanner: TriggerPlannerService,
    private readonly ruleNormalizer: RuleNormalizerService,
    private readonly evaluatorRegistry: SubscriptionEvaluatorRegistry,
  ) {
    super()
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case ScreenerSubscriptionJobName.BATCH_EXECUTE:
        return this.batchExecute(job.data as BatchExecuteData)
      case ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION:
        return this.executeSingle(job.data as ExecuteSingleData, job.id)
      default:
        this.logger.warn(`Unknown job name: ${job.name}`)
    }
  }

  /** Batch worker only fans out stable single-subscription jobs. */
  private async batchExecute(data: BatchExecuteData): Promise<void> {
    let cursor: number | undefined

    do {
      const subscriptions = await this.prisma.screenerSubscription.findMany({
        where: { status: SubscriptionStatus.ACTIVE, frequency: data.frequency },
        select: { id: true, ruleVersion: true },
        orderBy: { id: 'asc' },
        take: BATCH_PAGE_SIZE,
        ...(cursor !== undefined && { cursor: { id: cursor }, skip: 1 }),
      })
      if (!subscriptions.length) return

      await this.queue.addBulk(
        subscriptions.map((sub) => ({
          name: ScreenerSubscriptionJobName.EXECUTE_SUBSCRIPTION,
          data: {
            subscriptionId: sub.id,
            tradeDate: data.tradeDate,
            ruleVersion: sub.ruleVersion,
            expectedFrequency: data.frequency,
          },
          opts: {
            jobId: buildSubscriptionQueueJobId(sub.id, data.tradeDate, sub.ruleVersion),
            attempts: JOB_RETRY_ATTEMPTS,
            backoff: { type: 'exponential', delay: JOB_RETRY_DELAY_MS },
            removeOnComplete: 50,
            removeOnFail: true,
          },
        })),
      )
      cursor = subscriptions[subscriptions.length - 1].id
    } while (true)
  }

  private async executeSingle(data: ExecuteSingleData, jobId?: string): Promise<void> {
    const sub = await this.prisma.screenerSubscription.findUnique({ where: { id: data.subscriptionId } })
    if (!sub || sub.status !== SubscriptionStatus.ACTIVE) return
    if (data.ruleVersion !== undefined && data.ruleVersion !== sub.ruleVersion) return
    if (data.expectedFrequency !== undefined && data.expectedFrequency !== sub.frequency) return
    if (!data.recovery && sub.lastEvaluatedTradeDate !== null && data.tradeDate <= sub.lastEvaluatedTradeDate) {
      this.logger.warn(
        `Ignoring stale subscription ${sub.id} run for ${data.tradeDate}; latest is ${sub.lastEvaluatedTradeDate}`,
      )
      return
    }

    // 先单调推进 claim 水位：更晚交易日一旦被领取，旧日期的成功/失败均不能再改订阅状态。
    if (!data.recovery && !(await this.claimSubscriptionTradeDate(sub.id, sub.ruleVersion, data.tradeDate))) return

    const run = await this.claimRun(sub.id, data.tradeDate, sub.ruleVersion, jobId)
    if (!run) return

    const startMs = Date.now()

    try {
      // 新协议优先读取已冻结的 ruleSpec；存量行仍双读 legacy filters，且同样经过
      // normalizer，防止把任意 JSON 直接带入 SQL 条件构建器。
      const normalizedRule = sub.ruleSpec
        ? this.ruleNormalizer.normalizeRuleSpec(sub.ruleSpec)
        : this.ruleNormalizer.normalizeLegacyStockScreeningRule(sub.filters)
      const normalizedTriggerSpec = this.ruleNormalizer.normalizeTriggerSpec(
        sub.triggerSpec ?? undefined,
        normalizedRule.type,
      )
      const readiness = await this.dataReadiness.checkRule(normalizedRule, data.tradeDate)
      if (!readiness.ready) {
        const recorded = await this.recordDataNotReady(run, startMs, readiness)
        if (!recorded) return
        throw new SubscriptionDataNotReadyError(readiness.missing)
      }

      const evaluator = this.evaluatorRegistry.get(normalizedRule.type)
      const outcome = await evaluator.evaluate(
        {
          userId: sub.userId,
          tradeDate: data.tradeDate,
          previousSuccessfulTradeDate: sub.lastEvaluatedTradeDate,
          ruleVersion: sub.ruleVersion,
          preview: false,
          eventWindow: normalizedTriggerSpec.eventWindow,
        },
        normalizedRule,
      )
      const triggerPlan =
        normalizedRule.type === 'SIGNAL_EVENT'
          ? null
          : this.triggerPlanner.planCollection({
              hasBaseline: sub.lastEvaluatedTradeDate !== null,
              previousMatchCodes: sub.lastMatchCodes ?? [],
              currentMatchCodes: outcome.matchedCodes,
              triggerSpec: sub.triggerSpec ?? undefined,
            })
      const currentCodes = triggerPlan?.matchedCodes ?? outcome.matchedCodes
      const newEntryCodes = triggerPlan?.enterCodes ?? []
      const exitCodes = triggerPlan?.exitCodes ?? []
      const hits: Array<{ tsCode: string; kind: 'ENTER' | 'EXIT' | 'EVENT'; eventTradeDate?: string }> = triggerPlan
        ? triggerPlan.hits
        : (outcome.eventHits ?? []).map((hit) => ({ ...hit, kind: 'EVENT' as const }))
      const finishedAt = new Date()
      const executionMs = Date.now() - startMs
      const evidence = await evaluator.explain(
        {
          userId: sub.userId,
          tradeDate: data.tradeDate,
          previousSuccessfulTradeDate: sub.lastEvaluatedTradeDate,
          ruleVersion: sub.ruleVersion,
          preview: false,
          eventWindow: normalizedTriggerSpec.eventWindow,
        },
        normalizedRule,
        hits,
      )
      const evidenceByHit = new Map(
        evidence.map((item) => [`${item.tsCode}:${item.kind}:${item.details.eventTradeDate ?? ''}`, item]),
      )
      const dataVersions = {
        ...readiness.dataVersions,
        ...outcome.dataVersions,
        ...(normalizedRule.type === 'STOCK_SCREENING' && { screenedAsOfTradeDate: outcome.asOfTradeDate }),
      }

      const committed = await this.prisma.$transaction(async (tx) => {
        // 先完成带 attemptToken 的终态领取。若 lease 已被新 attempt 接管，旧 worker
        // 只能静默丢弃结果，绝不能再覆盖 log 或订阅状态。
        const finalizedLog = await tx.screenerSubscriptionLog.updateMany({
          where: {
            id: run.id,
            status: SubscriptionRunStatus.RUNNING,
            attemptToken: run.attemptToken,
          },
          data: {
            status: SubscriptionRunStatus.SUCCESS,
            matchCount: currentCodes.length,
            triggerCount: hits.length,
            newEntryCount: newEntryCodes.length,
            exitCount: exitCodes.length,
            newEntryCodes,
            exitCodes,
            dataVersions,
            executionMs,
            success: true,
            errorCode: null,
            errorMessage: null,
            startedAt: run.startedAt,
            finishedAt,
          },
        })
        if (finalizedLog.count === 0) return false

        // hit 是规则运行的可审计结果；数据库唯一键是通知去重的最终防线。
        // 集合规则的首次基线不产生 hit；事件规则只写已物化的日级事件。
        if (hits.length > 0) {
          await tx.screenerSubscriptionHit.createMany({
            data: hits.map((hit) => ({
              subscriptionId: sub.id,
              logId: run.id,
              tradeDate: data.tradeDate,
              eventTradeDate: hit.eventTradeDate ?? null,
              tsCode: hit.tsCode,
              kind: hit.kind,
              eventKey:
                hit.kind === 'EVENT'
                  ? `rule:${sub.ruleFingerprint ?? `v${sub.ruleVersion}`}:event:${hit.eventTradeDate}`
                  : `rule:${sub.ruleFingerprint ?? `v${sub.ruleVersion}`}:${hit.kind}`,
              evidence: (evidenceByHit.get(`${hit.tsCode}:${hit.kind}:${hit.eventTradeDate ?? ''}`) ?? {
                tsCode: hit.tsCode,
                kind: hit.kind,
                reason:
                  normalizedRule.type === 'STOCK_SCREENING'
                    ? hit.kind === 'ENTER'
                      ? '股票新进入基础选股结果集'
                      : '股票退出基础选股结果集'
                    : hit.kind === 'ENTER'
                      ? '股票新进入筛选结果集'
                      : '股票退出筛选结果集',
                details: { ruleType: sub.ruleType, ruleVersion: sub.ruleVersion, tradeDate: data.tradeDate },
              }) as unknown as Prisma.InputJsonObject,
            })),
            skipDuplicates: true,
          })
        }

        const subscriptionUpdate = await tx.screenerSubscription.updateMany({
          where: {
            id: sub.id,
            ruleVersion: sub.ruleVersion,
            status: SubscriptionStatus.ACTIVE,
            lastClaimedTradeDate: data.tradeDate,
            OR: [{ lastEvaluatedTradeDate: null }, { lastEvaluatedTradeDate: { lt: data.tradeDate } }],
          },
          data: {
            lastRunAt: finishedAt,
            lastEvaluatedTradeDate: data.tradeDate,
            lastRunResult: {
              tradeDate: data.tradeDate,
              matchCount: currentCodes.length,
              newEntryCount: newEntryCodes.length,
              exitCount: exitCodes.length,
              runKey: run.runKey,
              ruleVersion: sub.ruleVersion,
            },
            lastMatchCodes: currentCodes,
            consecutiveFails: 0,
          },
        })
        if (subscriptionUpdate.count === 0) {
          await tx.screenerSubscriptionLog.updateMany({
            where: {
              id: run.id,
              status: SubscriptionRunStatus.SUCCESS,
              attemptToken: run.attemptToken,
            },
            data: {
              warningCount: 1,
              errorCode: 'STALE_RUN_SUPERSEDED',
              errorMessage: '运行结果已被同规则版本的更新交易日覆盖',
              attemptToken: null,
            },
          })
          return false
        }
        await tx.screenerSubscriptionLog.updateMany({
          where: {
            id: run.id,
            status: SubscriptionRunStatus.SUCCESS,
            attemptToken: run.attemptToken,
          },
          data: { attemptToken: null },
        })
        return true
      })

      // 首次集合运行仅写完整基线；事件规则没有集合基线。
      if (committed && hits.length > 0) {
        try {
          this.eventsGateway.emitToUser(sub.userId, 'screener_subscription_alert', {
            subscriptionId: sub.id,
            subscriptionName: sub.name,
            tradeDate: data.tradeDate,
            newEntryCodes,
            exitCodes,
            totalMatch: currentCodes.length,
          })
          this.eventsGateway.emitToUser(sub.userId, 'screener_subscription_triggered', {
            subscriptionId: sub.id,
            subscriptionName: sub.name,
            ruleType: sub.ruleType,
            tradeDate: data.tradeDate,
            triggerCount: hits.length,
            kinds: [...new Set(hits.map((hit) => hit.kind))],
            preview: hits.slice(0, 20).map((hit) => ({
              tsCode: hit.tsCode,
              kind: hit.kind,
              reason:
                evidenceByHit.get(`${hit.tsCode}:${hit.kind}:${hit.eventTradeDate ?? ''}`)?.reason ??
                (hit.kind === 'ENTER'
                  ? '股票新进入筛选结果集'
                  : hit.kind === 'EXIT'
                    ? '股票退出筛选结果集'
                    : '股票满足技术事件订阅规则'),
            })),
          })
        } catch {
          this.logger.error(`Subscription ${sub.id} notification dispatch failed after run ${run.runKey} succeeded`)
        }
      }
    } catch (error) {
      if (error instanceof SubscriptionDataNotReadyError) throw error
      const failure = await this.recordFailure(sub, run, data.tradeDate, startMs, error)
      if (failure.ownershipLost) return
      throw failure.error
    }
  }

  private async claimSubscriptionTradeDate(
    subscriptionId: number,
    ruleVersion: number,
    tradeDate: string,
  ): Promise<boolean> {
    const claimed = await this.prisma.screenerSubscription.updateMany({
      where: {
        id: subscriptionId,
        ruleVersion,
        status: SubscriptionStatus.ACTIVE,
        OR: [{ lastClaimedTradeDate: null }, { lastClaimedTradeDate: { lte: tradeDate } }],
        AND: [{ OR: [{ lastEvaluatedTradeDate: null }, { lastEvaluatedTradeDate: { lt: tradeDate } }] }],
      },
      data: { lastClaimedTradeDate: tradeDate },
    })
    return claimed.count === 1
  }

  private async claimRun(
    subscriptionId: number,
    tradeDate: string,
    ruleVersion: number,
    jobId?: string,
  ): Promise<ClaimedRun | null> {
    const runKey = buildSubscriptionRunKey(subscriptionId, tradeDate, ruleVersion)
    const attemptToken = randomUUID()
    const startedAt = new Date()
    const existing = await this.prisma.screenerSubscriptionLog.findUnique({ where: { runKey } })

    if (existing) {
      if (existing.status === SubscriptionRunStatus.SUCCESS) return null

      const staleRunningBefore = new Date(Date.now() - RUNNING_LEASE_MS)
      const claimableStatuses = [
        SubscriptionRunStatus.QUEUED,
        SubscriptionRunStatus.FAILED,
        SubscriptionRunStatus.SKIPPED_DATA_NOT_READY,
      ]
      const claimed = await this.prisma.screenerSubscriptionLog.updateMany({
        where: {
          id: existing.id,
          OR: [
            { status: { in: claimableStatuses } },
            { status: SubscriptionRunStatus.RUNNING, startedAt: null },
            { status: SubscriptionRunStatus.RUNNING, startedAt: { lt: staleRunningBefore } },
          ],
        },
        data: {
          jobId: jobId ?? null,
          attemptToken,
          status: SubscriptionRunStatus.RUNNING,
          success: false,
          errorCode: null,
          errorMessage: null,
          startedAt,
          finishedAt: null,
        },
      })
      if (claimed.count === 1) {
        return { id: existing.id, runKey: existing.runKey ?? runKey, attemptToken, startedAt }
      }

      const current = await this.prisma.screenerSubscriptionLog.findUnique({ where: { runKey } })
      if (current?.status === SubscriptionRunStatus.SUCCESS) return null
      throw new SubscriptionRunInProgressError(runKey)
    }

    try {
      const created = await this.prisma.screenerSubscriptionLog.create({
        data: {
          subscriptionId,
          runKey,
          jobId: jobId ?? null,
          attemptToken,
          tradeDate,
          ruleVersion,
          status: SubscriptionRunStatus.RUNNING,
          success: false,
          startedAt,
        },
        select: { id: true, runKey: true },
      })
      return { id: created.id, runKey: created.runKey ?? runKey, attemptToken, startedAt }
    } catch (error) {
      // 并发 job 由数据库唯一 runKey 收敛。让 BullMQ 延迟重试，而不是把活跃运行误标记为完成。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const current = await this.prisma.screenerSubscriptionLog.findUnique({ where: { runKey } })
        if (current?.status === SubscriptionRunStatus.SUCCESS) return null
        throw new SubscriptionRunInProgressError(runKey)
      }
      throw error
    }
  }

  private async recordDataNotReady(
    run: ClaimedRun,
    startMs: number,
    readiness: SubscriptionDataReadinessResult,
  ): Promise<boolean> {
    const finishedAt = new Date()
    const missing = readiness.missing.join(', ').slice(0, 500)
    const recorded = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.screenerSubscriptionLog.updateMany({
        where: {
          id: run.id,
          status: SubscriptionRunStatus.RUNNING,
          attemptToken: run.attemptToken,
        },
        data: {
          status: SubscriptionRunStatus.SKIPPED_DATA_NOT_READY,
          warningCount: 1,
          executionMs: Date.now() - startMs,
          success: false,
          errorCode: 'DATA_NOT_READY',
          errorMessage: missing ? `数据暂未就绪：${missing}` : '数据暂未就绪',
          dataVersions: readiness.dataVersions,
          attemptToken: null,
          startedAt: run.startedAt,
          finishedAt,
        },
      })
      return updated.count === 1
    })
    if (recorded) this.logger.warn(`Subscription run ${run.runKey} skipped: data not ready (${missing || 'unknown'})`)
    return recorded
  }

  private async recordFailure(
    sub: { id: number; userId: number; ruleVersion: number; consecutiveFails: number },
    run: ClaimedRun,
    tradeDate: string,
    startMs: number,
    error: unknown,
  ): Promise<FailureRecord> {
    const executionError = this.toExecutionError(error)
    const finishedAt = new Date()

    const failure = await this.prisma.$transaction(async (tx) => {
      // 先用 token 领取终态写入。若已被新的 attempt 接管，旧 worker 不得覆盖其 log 或订阅状态。
      const finalizedLog = await tx.screenerSubscriptionLog.updateMany({
        where: {
          id: run.id,
          status: SubscriptionRunStatus.RUNNING,
          attemptToken: run.attemptToken,
        },
        data: {
          status: SubscriptionRunStatus.FAILED,
          executionMs: Date.now() - startMs,
          success: false,
          errorCode: executionError.code,
          errorMessage: executionError.message,
          startedAt: run.startedAt,
          finishedAt,
        },
      })
      if (finalizedLog.count === 0) {
        return {
          error: executionError,
          consecutiveFails: sub.consecutiveFails,
          transitionedToError: false,
          ownershipLost: true,
        }
      }

      const incremented = await tx.screenerSubscription.updateMany({
        where: {
          id: sub.id,
          ruleVersion: sub.ruleVersion,
          status: SubscriptionStatus.ACTIVE,
          lastClaimedTradeDate: tradeDate,
          OR: [{ lastEvaluatedTradeDate: null }, { lastEvaluatedTradeDate: { lt: tradeDate } }],
        },
        data: {
          consecutiveFails: { increment: 1 },
        },
      })

      const transitionedToError =
        incremented.count === 1 &&
        (
          await tx.screenerSubscription.updateMany({
            where: {
              id: sub.id,
              ruleVersion: sub.ruleVersion,
              status: SubscriptionStatus.ACTIVE,
              lastClaimedTradeDate: tradeDate,
              consecutiveFails: { gte: MAX_CONSECUTIVE_FAILS },
            },
            data: { status: SubscriptionStatus.ERROR },
          })
        ).count === 1

      const current =
        incremented.count === 1
          ? await tx.screenerSubscription.findUnique({
              where: { id: sub.id },
              select: { consecutiveFails: true },
            })
          : null

      await tx.screenerSubscriptionLog.updateMany({
        where: {
          id: run.id,
          status: SubscriptionRunStatus.FAILED,
          attemptToken: run.attemptToken,
        },
        data: { attemptToken: null },
      })

      return {
        error: executionError,
        consecutiveFails: current?.consecutiveFails ?? sub.consecutiveFails,
        transitionedToError,
        ownershipLost: false,
      }
    })

    this.logger.error(`Subscription ${sub.id} run ${run.runKey} failed: ${executionError.code}`)
    if (failure.transitionedToError) {
      try {
        this.eventsGateway.emitToUser(sub.userId, 'screener_subscription_failed', {
          subscriptionId: sub.id,
          tradeDate,
          errorCode: executionError.code,
          error: executionError.message,
          consecutiveFails: failure.consecutiveFails,
        })
      } catch {
        this.logger.error(`Subscription ${sub.id} failure notification dispatch failed`)
      }
    }
    return failure
  }

  private toExecutionError(error: unknown): SubscriptionExecutionError {
    if (error instanceof SubscriptionExecutionError) return error
    if (error instanceof RuleSpecValidationException)
      return new SubscriptionExecutionError('RULE_INVALID', '订阅规则无效')
    return new SubscriptionExecutionError('EVALUATION_FAILED', '订阅规则执行失败')
  }
}

class SubscriptionExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

class SubscriptionDataNotReadyError extends Error {
  constructor(missing: string[]) {
    super(`Subscription data is not ready: ${missing.join(', ') || 'unknown'}`)
  }
}

class SubscriptionRunInProgressError extends Error {
  constructor(runKey: string) {
    super(`Subscription run ${runKey} is already in progress`)
  }
}
