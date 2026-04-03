import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { BacktestRunService } from 'src/apps/backtest/services/backtest-run.service'
import { StrategySchemaValidatorService } from 'src/apps/strategy/strategy-schema-validator.service'
import { CreateStrategyDraftDto, SubmitDraftDto, UpdateStrategyDraftDto } from './dto/strategy-draft.dto'

/** 每用户最大草稿数量 */
const MAX_DRAFTS_PER_USER = 20

@Injectable()
export class StrategyDraftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly backtestRunService: BacktestRunService,
    private readonly schemaValidator: StrategySchemaValidatorService,
  ) {}

  async getDrafts(userId: number) {
    const drafts = await this.prisma.strategyDraft.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    })
    return { drafts }
  }

  async getDraft(userId: number, id: number) {
    const draft = await this.prisma.strategyDraft.findFirst({ where: { id, userId } })
    if (!draft) throw new NotFoundException('草稿不存在')
    return draft
  }

  async createDraft(userId: number, dto: CreateStrategyDraftDto) {
    const count = await this.prisma.strategyDraft.count({ where: { userId } })
    if (count >= MAX_DRAFTS_PER_USER) {
      throw new BadRequestException(`草稿数量已达上限（最多 ${MAX_DRAFTS_PER_USER} 个）`)
    }

    try {
      return await this.prisma.strategyDraft.create({
        data: {
          userId,
          name: dto.name,
          config: dto.config as Parameters<typeof this.prisma.strategyDraft.create>[0]['data']['config'],
        },
      })
    } catch (e: unknown) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002') throw new ConflictException('同名草稿已存在')
      throw e
    }
  }

  async updateDraft(userId: number, id: number, dto: UpdateStrategyDraftDto) {
    const existing = await this.prisma.strategyDraft.findFirst({ where: { id, userId } })
    if (!existing) throw new NotFoundException('草稿不存在')

    try {
      return await this.prisma.strategyDraft.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.config !== undefined && {
            config: dto.config as Parameters<typeof this.prisma.strategyDraft.update>[0]['data']['config'],
          }),
        },
      })
    } catch (e: unknown) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002') throw new ConflictException('同名草稿已存在')
      throw e
    }
  }

  async deleteDraft(userId: number, id: number) {
    const existing = await this.prisma.strategyDraft.findFirst({ where: { id, userId } })
    if (!existing) throw new NotFoundException('草稿不存在')

    await this.prisma.strategyDraft.delete({ where: { id } })
    return { message: '删除成功' }
  }

  async submitDraft(userId: number, draftId: number, dto: SubmitDraftDto) {
    const draft = await this.prisma.strategyDraft.findFirst({ where: { id: draftId, userId } })
    if (!draft) throw new NotFoundException('草稿不存在')

    const config = draft.config as Record<string, unknown>
    if (!config.strategyType) throw new BadRequestException('草稿中未指定 strategyType，无法提交回测')

    // 草稿提交前校验策略参数，提前发现配置错误
    if (config.strategyConfig !== undefined) {
      this.schemaValidator.validate(config.strategyType as string, config.strategyConfig)
    }

    const backtestDto = { ...config, name: dto.name ?? draft.name }
    return this.backtestRunService.createRun(
      backtestDto as Parameters<typeof this.backtestRunService.createRun>[0],
      userId,
    )
  }
}
