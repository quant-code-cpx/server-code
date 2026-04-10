import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { StrategyDraftService } from '../strategy-draft.service'
import { PrismaService } from 'src/shared/prisma.service'
import { BacktestRunService } from 'src/apps/backtest/services/backtest-run.service'
import { StrategySchemaValidatorService } from 'src/apps/strategy/strategy-schema-validator.service'
import { createMockPrismaService } from 'test/helpers/prisma-mock'

describe('StrategyDraftService', () => {
  let service: StrategyDraftService
  let prisma: ReturnType<typeof createMockPrismaService>
  let backtestRunService: jest.Mocked<Pick<BacktestRunService, 'createRun'>>
  let schemaValidator: jest.Mocked<Pick<StrategySchemaValidatorService, 'validate'>>

  beforeEach(async () => {
    prisma = createMockPrismaService()
    backtestRunService = { createRun: jest.fn() }
    schemaValidator = { validate: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategyDraftService,
        { provide: PrismaService, useValue: prisma },
        { provide: BacktestRunService, useValue: backtestRunService },
        { provide: StrategySchemaValidatorService, useValue: schemaValidator },
      ],
    }).compile()
    service = module.get(StrategyDraftService)
  })

  afterEach(() => jest.clearAllMocks())

  // ── getDrafts ─────────────────────────────────────────────────────────────

  it('getDrafts — 返回用户所有草稿', async () => {
    const drafts = [{ id: 1 }, { id: 2 }]
    prisma.strategyDraft.findMany.mockResolvedValue(drafts as never)

    const result = await service.getDrafts(1)
    expect(result).toEqual({ drafts })
    expect(prisma.strategyDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1 } }),
    )
  })

  // ── getDraft ──────────────────────────────────────────────────────────────

  it('getDraft — 存在 → 返回草稿', async () => {
    const draft = { id: 1, userId: 1 }
    prisma.strategyDraft.findFirst.mockResolvedValue(draft as never)

    const result = await service.getDraft(1, 1)
    expect(result).toBe(draft)
  })

  it('getDraft — 不存在 → NotFoundException', async () => {
    prisma.strategyDraft.findFirst.mockResolvedValue(null)
    await expect(service.getDraft(1, 99)).rejects.toThrow(NotFoundException)
  })

  // ── createDraft ───────────────────────────────────────────────────────────

  it('createDraft — 正常 → 创建草稿', async () => {
    prisma.strategyDraft.count.mockResolvedValue(0)
    const created = { id: 1, name: '草稿1' }
    prisma.strategyDraft.create.mockResolvedValue(created as never)

    const result = await service.createDraft(1, { name: '草稿1', config: {} })
    expect(result).toBe(created)
  })

  it('createDraft — 超上限(20) → BadRequestException', async () => {
    prisma.strategyDraft.count.mockResolvedValue(20)
    await expect(service.createDraft(1, { name: 'x', config: {} })).rejects.toThrow(BadRequestException)
  })

  it('createDraft — 重名(P2002) → ConflictException', async () => {
    prisma.strategyDraft.count.mockResolvedValue(0)
    prisma.strategyDraft.create.mockRejectedValue({ code: 'P2002' })

    await expect(service.createDraft(1, { name: 'dup', config: {} })).rejects.toThrow(ConflictException)
  })

  // ── updateDraft ───────────────────────────────────────────────────────────

  it('updateDraft — 存在 → 更新并返回', async () => {
    const existing = { id: 1, userId: 1 }
    const updated = { id: 1, name: '新名称' }
    prisma.strategyDraft.findFirst.mockResolvedValue(existing as never)
    prisma.strategyDraft.update.mockResolvedValue(updated as never)

    const result = await service.updateDraft(1, 1, { name: '新名称' })
    expect(result).toBe(updated)
  })

  it('updateDraft — 不存在 → NotFoundException', async () => {
    prisma.strategyDraft.findFirst.mockResolvedValue(null)
    await expect(service.updateDraft(1, 99, { name: 'x' })).rejects.toThrow(NotFoundException)
  })

  it('updateDraft — 重名(P2002) → ConflictException', async () => {
    prisma.strategyDraft.findFirst.mockResolvedValue({ id: 1 } as never)
    prisma.strategyDraft.update.mockRejectedValue({ code: 'P2002' })

    await expect(service.updateDraft(1, 1, { name: 'dup' })).rejects.toThrow(ConflictException)
  })

  // ── deleteDraft ───────────────────────────────────────────────────────────

  it('deleteDraft — 存在 → 删除并返回成功消息', async () => {
    prisma.strategyDraft.findFirst.mockResolvedValue({ id: 1 } as never)
    prisma.strategyDraft.delete.mockResolvedValue({} as never)

    const result = await service.deleteDraft(1, 1)
    expect(result.message).toBeDefined()
    expect(prisma.strategyDraft.delete).toHaveBeenCalledWith({ where: { id: 1 } })
  })

  it('deleteDraft — 不存在 → NotFoundException', async () => {
    prisma.strategyDraft.findFirst.mockResolvedValue(null)
    await expect(service.deleteDraft(1, 99)).rejects.toThrow(NotFoundException)
  })

  // ── submitDraft ───────────────────────────────────────────────────────────

  it('submitDraft — 正常 → 验证 schema 并调用 createRun', async () => {
    const draft = {
      id: 1,
      userId: 1,
      name: '草稿A',
      config: { strategyType: 'MA_CROSS_SINGLE', strategyConfig: { shortWindow: 5, longWindow: 20 } },
    }
    prisma.strategyDraft.findFirst.mockResolvedValue(draft as never)
    backtestRunService.createRun.mockResolvedValue({ id: 'run-1' } as never)

    const result = await service.submitDraft(1, 1, {})
    expect(schemaValidator.validate).toHaveBeenCalledWith('MA_CROSS_SINGLE', draft.config.strategyConfig)
    expect(backtestRunService.createRun).toHaveBeenCalled()
    expect(result).toEqual({ id: 'run-1' })
  })

  it('submitDraft — 草稿不存在 → NotFoundException', async () => {
    prisma.strategyDraft.findFirst.mockResolvedValue(null)
    await expect(service.submitDraft(1, 99, {})).rejects.toThrow(NotFoundException)
  })

  it('submitDraft — config 缺少 strategyType → BadRequestException', async () => {
    const draft = { id: 1, userId: 1, name: '草稿B', config: {} }
    prisma.strategyDraft.findFirst.mockResolvedValue(draft as never)

    await expect(service.submitDraft(1, 1, {})).rejects.toThrow(BadRequestException)
  })

  it('submitDraft — 无 strategyConfig → 跳过 schema 验证', async () => {
    const draft = {
      id: 1,
      userId: 1,
      name: '草稿C',
      config: { strategyType: 'MA_CROSS_SINGLE' },
    }
    prisma.strategyDraft.findFirst.mockResolvedValue(draft as never)
    backtestRunService.createRun.mockResolvedValue({ id: 'run-2' } as never)

    await service.submitDraft(1, 1, {})
    expect(schemaValidator.validate).not.toHaveBeenCalled()
    expect(backtestRunService.createRun).toHaveBeenCalled()
  })
})
