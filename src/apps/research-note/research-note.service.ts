import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { CreateResearchNoteDto, ResearchNoteQueryDto, UpdateResearchNoteDto } from './dto/research-note.dto'

/** 每用户最大笔记数量 */
const MAX_NOTES_PER_USER = 500

@Injectable()
export class ResearchNoteService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: number, query: ResearchNoteQueryDto) {
    const where: Prisma.ResearchNoteWhereInput = { userId }

    if (query.tsCode) where.tsCode = query.tsCode
    if (query.tags?.length) where.tags = { hasEvery: query.tags }
    if (query.keyword) {
      where.OR = [
        { title: { contains: query.keyword, mode: 'insensitive' } },
        { content: { contains: query.keyword, mode: 'insensitive' } },
      ]
    }

    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const sortBy = (query.sortBy ?? 'updatedAt') as 'createdAt' | 'updatedAt'
    const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc'

    const [notes, total] = await Promise.all([
      this.prisma.researchNote.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, { [sortBy]: sortOrder }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.researchNote.count({ where }),
    ])

    return { notes, total, page, pageSize }
  }

  async findOne(userId: number, id: number) {
    const note = await this.prisma.researchNote.findFirst({ where: { id, userId } })
    if (!note) throw new NotFoundException('笔记不存在')
    return note
  }

  async create(userId: number, dto: CreateResearchNoteDto) {
    const count = await this.prisma.researchNote.count({ where: { userId } })
    if (count >= MAX_NOTES_PER_USER) {
      throw new BadRequestException(`笔记数量已达上限（最多 ${MAX_NOTES_PER_USER} 条）`)
    }

    if (dto.tsCode) {
      const stockExists = await this.prisma.stockBasic.findFirst({ where: { tsCode: dto.tsCode } })
      if (!stockExists) throw new NotFoundException(`股票代码 ${dto.tsCode} 不存在`)
    }

    return this.prisma.researchNote.create({
      data: {
        userId,
        tsCode: dto.tsCode ?? null,
        title: dto.title,
        content: dto.content,
        tags: dto.tags ?? [],
        isPinned: dto.isPinned ?? false,
      },
    })
  }

  async update(userId: number, id: number, dto: UpdateResearchNoteDto) {
    const note = await this.prisma.researchNote.findFirst({ where: { id, userId } })
    if (!note) throw new NotFoundException('笔记不存在')

    return this.prisma.researchNote.update({
      where: { id },
      data: {
        ...(dto.tsCode !== undefined && { tsCode: dto.tsCode }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.isPinned !== undefined && { isPinned: dto.isPinned }),
      },
    })
  }

  async remove(userId: number, id: number) {
    const note = await this.prisma.researchNote.findFirst({ where: { id, userId } })
    if (!note) throw new NotFoundException('笔记不存在')

    await this.prisma.researchNote.delete({ where: { id } })
    return { message: '删除成功' }
  }

  async getUserTags(userId: number): Promise<{ tags: string[] }> {
    const notes = await this.prisma.researchNote.findMany({
      where: { userId },
      select: { tags: true },
    })
    const allTags = notes.flatMap((n) => n.tags)
    const tags = [...new Set(allTags)].sort()
    return { tags }
  }

  async findByStock(userId: number, tsCode: string) {
    const notes = await this.prisma.researchNote.findMany({
      where: { userId, tsCode },
      orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
    })
    return { notes, total: notes.length }
  }
}
