import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ResearchNoteService } from '../research-note.service'
import { PrismaService } from 'src/shared/prisma.service'
import { createMockPrismaService } from 'test/helpers/prisma-mock'

describe('ResearchNoteService', () => {
  let service: ResearchNoteService
  let prisma: ReturnType<typeof createMockPrismaService>

  beforeEach(async () => {
    prisma = createMockPrismaService()
    const module: TestingModule = await Test.createTestingModule({
      providers: [ResearchNoteService, { provide: PrismaService, useValue: prisma }],
    }).compile()
    service = module.get(ResearchNoteService)
  })

  afterEach(() => jest.clearAllMocks())

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('无筛选条件 → 返回分页数据', async () => {
      const notes = [
        { id: 1, userId: 1, tsCode: null, title: 'note1', content: 'abc', tags: [], isPinned: false, deletedAt: null },
      ]
      prisma.researchNote.findMany.mockResolvedValue(notes as never)
      prisma.researchNote.count.mockResolvedValue(1)

      const result = await service.findAll(1, { page: 1, pageSize: 20 })

      expect(result.total).toBe(1)
      expect(result.notes[0]).toMatchObject({ id: 1, title: 'note1', wordCount: 3, versionCount: 1, deletedAt: null })
      expect(prisma.researchNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 1, deletedAt: null } }),
      )
    })

    it('按 tsCode 筛选 → where 包含 tsCode', async () => {
      prisma.researchNote.findMany.mockResolvedValue([])
      prisma.researchNote.count.mockResolvedValue(0)

      await service.findAll(1, { tsCode: '000001.SZ' })

      expect(prisma.researchNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tsCode: '000001.SZ' }) }),
      )
    })

    it('按 keyword 筛选 → where 包含 OR 条件', async () => {
      prisma.researchNote.findMany.mockResolvedValue([])
      prisma.researchNote.count.mockResolvedValue(0)

      await service.findAll(1, { keyword: 'test' })

      expect(prisma.researchNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) }),
      )
    })

    it('按 tags 筛选 → where 包含 hasEvery', async () => {
      prisma.researchNote.findMany.mockResolvedValue([])
      prisma.researchNote.count.mockResolvedValue(0)

      await service.findAll(1, { tags: ['量化', '回测'] })

      expect(prisma.researchNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tags: { hasEvery: ['量化', '回测'] } }),
        }),
      )
    })
  })

  // ── findOne ───────────────────────────────────────────────────────────────

  it('findOne — 存在 → 返回笔记', async () => {
    const note = {
      id: 1,
      userId: 1,
      tsCode: null,
      title: 't',
      content: '内容',
      tags: [],
      isPinned: false,
      deletedAt: null,
    }
    prisma.researchNote.findFirst.mockResolvedValue(note as never)

    const result = await service.findOne(1, 1)
    expect(result).toMatchObject({ id: 1, wordCount: 2, versionCount: 1 })
  })

  it('findOne — 不存在 → NotFoundException', async () => {
    prisma.researchNote.findFirst.mockResolvedValue(null)
    await expect(service.findOne(1, 99)).rejects.toThrow(NotFoundException)
  })

  // ── create ────────────────────────────────────────────────────────────────

  it('create — 正常 → 创建笔记', async () => {
    prisma.researchNote.count.mockResolvedValue(0)
    prisma.stockBasic.findFirst.mockResolvedValue({ tsCode: '000001.SZ' } as never)
    const created = {
      id: 1,
      userId: 1,
      tsCode: '000001.SZ',
      title: '新笔记',
      content: '内容',
      tags: [],
      isPinned: false,
      deletedAt: null,
      wordCount: 2,
      versionCount: 1,
    }
    prisma.researchNote.create.mockResolvedValue(created as never)

    const result = await service.create(1, { title: '新笔记', content: '内容', tsCode: '000001.SZ' })
    expect(result).toMatchObject({ id: 1, title: '新笔记', wordCount: 2 })
  })

  it('create — 超上限 → BadRequestException', async () => {
    prisma.researchNote.count.mockResolvedValue(500)
    await expect(service.create(1, { title: 't', content: 'c' })).rejects.toThrow(BadRequestException)
  })

  it('create — 股票不存在 → NotFoundException', async () => {
    prisma.researchNote.count.mockResolvedValue(0)
    prisma.stockBasic.findFirst.mockResolvedValue(null)

    await expect(service.create(1, { title: 't', content: 'c', tsCode: '000099.SZ' })).rejects.toThrow(
      NotFoundException,
    )
  })

  it('create — 无 tsCode → 不查 stockBasic', async () => {
    prisma.researchNote.count.mockResolvedValue(0)
    prisma.researchNote.create.mockResolvedValue({ id: 2 } as never)

    await service.create(1, { title: 't', content: 'c' })
    expect(prisma.stockBasic.findFirst).not.toHaveBeenCalled()
  })

  // ── update ────────────────────────────────────────────────────────────────

  it('update — 存在 → 更新并返回', async () => {
    const existing = { id: 1, userId: 1 }
    const updated = {
      id: 1,
      userId: 1,
      tsCode: null,
      title: '新标题',
      content: '内容',
      tags: [],
      isPinned: false,
      deletedAt: null,
      versionCount: 2,
    }
    prisma.researchNote.findFirst.mockResolvedValue(existing as never)
    prisma.researchNote.update.mockResolvedValue(updated as never)

    const result = await service.update(1, 1, { title: '新标题' })
    expect(result).toMatchObject({ id: 1, title: '新标题', versionCount: 2 })
  })

  it('update — 不存在 → NotFoundException', async () => {
    prisma.researchNote.findFirst.mockResolvedValue(null)
    await expect(service.update(1, 99, { title: 'x' })).rejects.toThrow(NotFoundException)
  })

  // ── remove ────────────────────────────────────────────────────────────────

  it('remove — 存在 → 删除并返回成功消息', async () => {
    prisma.researchNote.findFirst.mockResolvedValue({ id: 1 } as never)
    prisma.researchNote.update.mockResolvedValue({} as never)

    const result = await service.remove(1, 1)
    expect(result.message).toBeDefined()
    expect(prisma.researchNote.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { deletedAt: expect.any(Date) } })
  })

  it('remove — 不存在 → NotFoundException', async () => {
    prisma.researchNote.findFirst.mockResolvedValue(null)
    await expect(service.remove(1, 99)).rejects.toThrow(NotFoundException)
  })

  // ── getUserTags ───────────────────────────────────────────────────────────

  it('getUserTags — 去重排序后返回', async () => {
    prisma.researchNote.findMany.mockResolvedValue([{ tags: ['量化', '回测'] }, { tags: ['量化', '因子'] }] as never)

    const result = await service.getUserTags(1)
    expect(result.tags).toEqual([
      { tag: '回测', count: 1 },
      { tag: '量化', count: 2 },
      { tag: '因子', count: 1 },
    ])
  })

  it('getUserTags — 无笔记 → 空数组', async () => {
    prisma.researchNote.findMany.mockResolvedValue([])
    const result = await service.getUserTags(1)
    expect(result.tags).toEqual([])
  })

  // ── findByStock ───────────────────────────────────────────────────────────

  it('findByStock — 返回该股票的笔记列表', async () => {
    const notes = [
      { id: 1, userId: 1, tsCode: '000001.SZ', title: 'a', content: 'a', tags: [], isPinned: false, deletedAt: null },
      { id: 2, userId: 1, tsCode: '000001.SZ', title: 'b', content: 'bb', tags: [], isPinned: false, deletedAt: null },
    ]
    prisma.researchNote.findMany.mockResolvedValue(notes as never)

    const result = await service.findByStock(1, '000001.SZ')
    expect(result.total).toBe(2)
    expect(result.notes[1]).toMatchObject({ id: 2, wordCount: 2 })
    expect(prisma.researchNote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1, tsCode: '000001.SZ', deletedAt: null } }),
    )
  })
})
