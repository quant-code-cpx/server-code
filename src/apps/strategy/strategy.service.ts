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

    return { strategies, total, page, pageSize }
  }

  async detail(userId: number, id: string) {
    const strategy = await this.prisma.strategy.findFirst({ where: { id, userId } })
    if (!strategy) throw new BusinessException(ErrorEnum.STRATEGY_NOT_FOUND)
    return strategy
  }

  async update(userId: number, dto: UpdateStrategyDto) {
    const strategy = await this.prisma.strategy.findFirst({ where: { id: dto.id, userId } })
    if (!strategy) throw new BusinessException(ErrorEnum.STRATEGY_NOT_FOUND)

    if (dto.tags && dto.tags.length > MAX_TAGS_PER_STRATEGY) {
      throw new BusinessException(`标签最多 ${MAX_TAGS_PER_STRATEGY} 个`)
    }

    let validatedConfig: Record<string, unknown> | undefined
    let versionIncrement = 0

    if (dto.strategyConfig !== undefined) {
      // 策略参数变更时重新校验，并递增版本号
      validatedConfig = this.schemaValidator.validate(strategy.strategyType, dto.strategyConfig)
      versionIncrement = 1
    }

    try {
      return await this.prisma.strategy.update({
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
    } catch (e: unknown) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        throw new BusinessException(ErrorEnum.STRATEGY_NAME_EXISTS)
      }
      throw e
    }
  }

  async delete(userId: number, id: string) {
    const strategy = await this.prisma.strategy.findFirst({ where: { id, userId } })
    if (!strategy) throw new BusinessException(ErrorEnum.STRATEGY_NOT_FOUND)

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

  getSchemas() {
    return this.schemaValidator.getAllSchemas()
  }
}
