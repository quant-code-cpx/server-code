import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { PrismaService } from 'src/shared/prisma.service'
import { BacktestRunService } from 'src/apps/backtest/services/backtest-run.service'
import { CreateStrategyDto } from './dto/create-strategy.dto'
import { UpdateStrategyDto } from './dto/update-strategy.dto'
import { QueryStrategyDto } from './dto/query-strategy.dto'
import { RunStrategyDto } from './dto/run-strategy.dto'
import { StrategySchemaValidatorService } from './strategy-schema-validator.service'
import {
  CompareVersionsDto,
  CompareVersionsResponseDto,
  ConfigDiffItem,
  StrategyVersionItemDto,
  VersionMetrics,
} from './dto/strategy-version.dto'

/** 每用户最大策略数量 */
const MAX_STRATEGIES_PER_USER = 50

/** 每策略最大标签数量 */
const MAX_TAGS_PER_STRATEGY = 10

@Injectable()
export class StrategyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backtestRunService: BacktestRunService,
    private readonly schemaValidator: StrategySchemaValidatorService,
  ) {}

  async create(userId: number, dto: CreateStrategyDto) {
    // 校验策略参数
    const validatedConfig = this.schemaValidator.validate(dto.strategyType, dto.strategyConfig)

    // 检查标签数量
    if (dto.tags && dto.tags.length > MAX_TAGS_PER_STRATEGY) {
      throw new BusinessException(`标签最多 ${MAX_TAGS_PER_STRATEGY} 个`)
    }

    // 检查用户策略上限
    const count = await this.prisma.strategy.count({ where: { userId } })
    if (count >= MAX_STRATEGIES_PER_USER) {
      throw new BusinessException(ErrorEnum.STRATEGY_LIMIT_EXCEEDED)
    }

    try {
      return await this.prisma.strategy.create({
        data: {
          userId,
          name: dto.name,
          description: dto.description ?? null,
          strategyType: dto.strategyType,
          strategyConfig: validatedConfig as Prisma.InputJsonValue,
          backtestDefaults: dto.backtestDefaults ? (dto.backtestDefaults as Prisma.InputJsonValue) : undefined,
          tags: dto.tags ?? [],
          version: 1,
        },
      })
    } catch (e: unknown) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        throw new BusinessException(ErrorEnum.STRATEGY_NAME_EXISTS)
      }
      throw e
    }
  }

  async list(userId: number, dto: QueryStrategyDto) {
    const page = dto.page ?? 1
    const pageSize = dto.pageSize ?? 20
    const skip = (page - 1) * pageSize

    const where: Prisma.StrategyWhereInput = { userId }

    if (dto.strategyType) {
      where.strategyType = dto.strategyType
    }

    if (dto.tags && dto.tags.length > 0) {
      where.tags = { hasEvery: dto.tags }
    }

    if (dto.keyword) {
      const kw = dto.keyword.trim()
      where.OR = [
        { name: { contains: kw, mode: 'insensitive' } },
        { description: { contains: kw, mode: 'insensitive' } },
      ]
    }

    const [strategies, total] = await Promise.all([
      this.prisma.strategy.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.strategy.count({ where }),
    ])

    // Enrich with latest backtest run per strategy (requires strategy_id FK on backtest_runs)
    const strategyIds = strategies.map((s) => s.id)
    let runMap = new Map<
      string,
      {
        runId: string
        status: string
        totalReturn: number | null
        annualizedReturn: number | null
        sharpeRatio: number | null
        maxDrawdown: number | null
        completedAt: string | null
      }
    >()

    if (strategyIds.length > 0) {
      const latestRuns = await this.prisma.$queryRaw<
        Array<{
          sid: string
          rid: string
          status: string
          total_return: number | null
          annualized_return: number | null
          sharpe_ratio: number | null
          max_drawdown: number | null
          completed_at: Date | null
        }>
      >`
        SELECT DISTINCT ON (strategy_id)
          strategy_id AS sid, id AS rid,
          status, total_return, annualized_return, sharpe_ratio, max_drawdown, completed_at
        FROM backtest_runs
        WHERE user_id = ${userId}
          AND deleted_at IS NULL
          AND strategy_id = ANY(${strategyIds}::text[])
        ORDER BY strategy_id, created_at DESC
      `
      runMap = new Map(
        latestRuns.map((r) => [
          r.sid,
          {
            runId: r.rid,
            status: r.status,
            totalReturn: r.total_return,
            annualizedReturn: r.annualized_return,
            sharpeRatio: r.sharpe_ratio,
            maxDrawdown: r.max_drawdown,
            completedAt: r.completed_at?.toISOString() ?? null,
          },
        ]),
      )
    }

    const items = strategies.map((s) => ({
      ...s,
      lastRunSummary: runMap.get(s.id) ?? null,
    }))

    return { strategies: items, total, page, pageSize }
  }

  async detail(userId: number, id: string) {
    const strategy = await this.prisma.strategy.findFirst({ where: { id, userId } })
    if (!strategy) throw new BusinessException(ErrorEnum.STRATEGY_NOT_FOUND)
    return strategy
  }

  async update(userId: number, dto: UpdateStrategyDto) {
    if (dto.tags && dto.tags.length > MAX_TAGS_PER_STRATEGY) {
      throw new BusinessException(`标签最多 ${MAX_TAGS_PER_STRATEGY} 个`)
    }

    const configChanged = dto.strategyConfig !== undefined
    const defaultsChanged = dto.backtestDefaults !== undefined
    const versionIncrement = configChanged || defaultsChanged ? 1 : 0

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 在事务内重新读取策略，确保 version 一致性（避免并发版本快照冲突）
        const strategy = await tx.strategy.findFirst({ where: { id: dto.id, userId } })
        if (!strategy) throw new BusinessException(ErrorEnum.STRATEGY_NOT_FOUND)

        let validatedConfig: Record<string, unknown> | undefined
        if (configChanged) {
          validatedConfig = this.schemaValidator.validate(strategy.strategyType, dto.strategyConfig)
        }

        if (versionIncrement > 0) {
          // 快照当前版本到 StrategyVersion
          await tx.strategyVersion.create({
            data: {
              strategyId: strategy.id,
              version: strategy.version,
              strategyConfig: strategy.strategyConfig as Prisma.InputJsonValue,
              backtestDefaults: strategy.backtestDefaults
                ? (strategy.backtestDefaults as Prisma.InputJsonValue)
                : undefined,
            },
          })
        }

        return tx.strategy.update({
          where: { id: dto.id },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.description !== undefined && { description: dto.description }),
            ...(validatedConfig !== undefined && { strategyConfig: validatedConfig as Prisma.InputJsonValue }),
            ...(dto.backtestDefaults !== undefined && {
              backtestDefaults: dto.backtestDefaults as Prisma.InputJsonValue,
            }),
            ...(dto.tags !== undefined && { tags: dto.tags }),
            ...(versionIncrement > 0 && { version: { increment: versionIncrement } }),
          },
        })
      })
    } catch (e: unknown) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        throw new BusinessException(ErrorEnum.STRATEGY_NAME_EXISTS)
      }
      throw e
    }
  }

  async delete(userId: number, id: string, force = false) {
    const strategy = await this.prisma.strategy.findFirst({ where: { id, userId } })
    if (!strategy) throw new BusinessException(ErrorEnum.STRATEGY_NOT_FOUND)

    const [runCount, signalCount] = await Promise.all([
      this.prisma.backtestRun.count({ where: { userId, strategyId: id, deletedAt: null } }),
      this.prisma.tradingSignal.count({ where: { strategyId: id } }),
    ])

    const hasRefs = runCount > 0 || signalCount > 0
    if (hasRefs && !force) {
      return {
        blocked: true,
        references: {
          backtestRuns: runCount,
          tradingSignals: signalCount,
        },
        message: '该策略存在关联数据，请使用 force=true 强制删除',
      }
    }

    await this.prisma.strategy.delete({ where: { id } })
    return { message: '删除成功' }
  }

  async clone(userId: number, sourceId: string, newName?: string) {
    // 允许克隆自己的策略，或公开策略
    const source = await this.prisma.strategy.findFirst({
      where: { id: sourceId, OR: [{ userId }, { isPublic: true }] },
    })
    if (!source) throw new BusinessException(ErrorEnum.STRATEGY_NOT_FOUND)

    const count = await this.prisma.strategy.count({ where: { userId } })
    if (count >= MAX_STRATEGIES_PER_USER) {
      throw new BusinessException(ErrorEnum.STRATEGY_LIMIT_EXCEEDED)
    }

    const name = newName ?? `${source.name} (副本)`

    try {
      return await this.prisma.strategy.create({
        data: {
          userId,
          name,
          description: source.description,
          strategyType: source.strategyType,
          strategyConfig: source.strategyConfig as Prisma.InputJsonValue,
          backtestDefaults: source.backtestDefaults ? (source.backtestDefaults as Prisma.InputJsonValue) : undefined,
          tags: source.tags,
          version: 1,
        },
      })
    } catch (e: unknown) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        throw new BusinessException(ErrorEnum.STRATEGY_NAME_EXISTS)
      }
      throw e
    }
  }

  async run(userId: number, dto: RunStrategyDto) {
    const strategy = await this.prisma.strategy.findFirst({ where: { id: dto.strategyId, userId } })
    if (!strategy) throw new BusinessException(ErrorEnum.STRATEGY_NOT_FOUND)

    const defaults = (strategy.backtestDefaults ?? {}) as Record<string, unknown>
    type RunParams = Parameters<typeof this.backtestRunService.createRun>[0]

    // 参数合并：RunStrategyDto 覆盖 backtestDefaults
    return this.backtestRunService.createRun(
      {
        name: dto.name ?? `${strategy.name} 回测`,
        strategyId: strategy.id,
        strategyType: strategy.strategyType as RunParams['strategyType'],
        strategyConfig: strategy.strategyConfig as Record<string, unknown>,
        startDate: dto.startDate,
        endDate: dto.endDate,
        initialCapital: dto.initialCapital,
        benchmarkTsCode: dto.benchmarkTsCode ?? (defaults.benchmarkTsCode as string | undefined) ?? '000300.SH',
        universe: (dto.universe ?? (defaults.universe as string | undefined) ?? 'ALL_A') as RunParams['universe'],
        customUniverseTsCodes: defaults.customUniverse as string[] | undefined,
        rebalanceFrequency: (dto.rebalanceFrequency ??
          (defaults.rebalanceFrequency as string | undefined) ??
          'MONTHLY') as RunParams['rebalanceFrequency'],
        priceMode: (dto.priceMode ??
          (defaults.priceMode as string | undefined) ??
          'NEXT_OPEN') as RunParams['priceMode'],
        commissionRate: dto.commissionRate ?? (defaults.commissionRate as number | undefined) ?? 0.0003,
        stampDutyRate: dto.stampDutyRate ?? (defaults.stampDutyRate as number | undefined) ?? 0.0005,
        minCommission: dto.minCommission ?? 5,
        slippageBps: dto.slippageBps ?? (defaults.slippageBps as number | undefined) ?? 5,
        maxPositions: dto.maxPositions ?? 20,
        maxWeightPerStock: dto.maxWeightPerStock ?? 0.1,
        minDaysListed: dto.minDaysListed ?? 60,
        enableTradeConstraints: dto.enableTradeConstraints ?? true,
        enableT1Restriction: dto.enableT1Restriction ?? true,
        partialFillEnabled: dto.partialFillEnabled ?? true,
      },
      userId,
    )
  }

  async listVersions(userId: number, strategyId: string): Promise<StrategyVersionItemDto[]> {
    const strategy = await this.prisma.strategy.findFirst({ where: { id: strategyId, userId } })
    if (!strategy) throw new BusinessException(ErrorEnum.STRATEGY_NOT_FOUND)

    const snapshots = await this.prisma.strategyVersion.findMany({
      where: { strategyId },
      orderBy: { version: 'asc' },
    })

    const items: StrategyVersionItemDto[] = snapshots.map((s) => ({
      version: s.version,
      strategyConfig: s.strategyConfig as Record<string, unknown>,
      backtestDefaults: s.backtestDefaults as Record<string, unknown> | null,
      changelog: s.changelog,
      createdAt: s.createdAt,
      isCurrent: false,
    }))

    // Append the current (live) version
    items.push({
      version: strategy.version,
      strategyConfig: strategy.strategyConfig as Record<string, unknown>,
      backtestDefaults: strategy.backtestDefaults as Record<string, unknown> | null,
      changelog: null,
      createdAt: strategy.updatedAt,
      isCurrent: true,
    })

    return items
  }

  async compareVersions(userId: number, dto: CompareVersionsDto): Promise<CompareVersionsResponseDto> {
    const strategy = await this.prisma.strategy.findFirst({ where: { id: dto.strategyId, userId } })
    if (!strategy) throw new BusinessException(ErrorEnum.STRATEGY_NOT_FOUND)

    if (dto.versionA >= dto.versionB) {
      throw new BusinessException('版本 A 必须小于版本 B')
    }

    const resolveConfig = async (version: number): Promise<Record<string, unknown>> => {
      if (version === strategy.version) {
        return strategy.strategyConfig as Record<string, unknown>
      }
      const snap = await this.prisma.strategyVersion.findUnique({
        where: { strategyId_version: { strategyId: dto.strategyId, version } },
      })
      if (!snap) throw new BusinessException(`版本 ${version} 不存在`)
      return snap.strategyConfig as Record<string, unknown>
    }

    const [configA, configB] = await Promise.all([resolveConfig(dto.versionA), resolveConfig(dto.versionB)])
    const diff = this.diffConfigs(configA, configB)

    const findMetrics = async (config: Record<string, unknown>): Promise<VersionMetrics | null> => {
      const run = await this.prisma.backtestRun.findFirst({
        where: { userId, strategyConfig: { equals: config as unknown as Prisma.InputJsonValue } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          totalReturn: true,
          annualizedReturn: true,
          sharpeRatio: true,
          maxDrawdown: true,
          sortinoRatio: true,
        },
      })
      if (!run) return null
      return {
        runId: run.id,
        totalReturn: run.totalReturn,
        annualizedReturn: run.annualizedReturn,
        sharpeRatio: run.sharpeRatio,
        maxDrawdown: run.maxDrawdown,
        sortinoRatio: run.sortinoRatio,
      }
    }

    const [metricsA, metricsB] = await Promise.all([findMetrics(configA), findMetrics(configB)])

    return {
      strategyId: dto.strategyId,
      versionA: dto.versionA,
      versionB: dto.versionB,
      configA,
      configB,
      diff,
      metricsA,
      metricsB,
    }
  }

  private diffConfigs(a: Record<string, unknown>, b: Record<string, unknown>): ConfigDiffItem[] {
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])
    const result: ConfigDiffItem[] = []
    for (const key of allKeys) {
      if (!(key in a)) {
        result.push({ path: key, oldValue: undefined, newValue: b[key], changeType: 'ADDED' })
      } else if (!(key in b)) {
        result.push({ path: key, oldValue: a[key], newValue: undefined, changeType: 'REMOVED' })
      } else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        result.push({ path: key, oldValue: a[key], newValue: b[key], changeType: 'CHANGED' })
      }
    }
    return result
  }

  getSchemas() {
    return this.schemaValidator.getAllSchemas()
  }
}
