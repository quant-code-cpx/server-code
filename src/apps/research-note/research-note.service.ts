import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { addUtcDays, parseCompactTradeDateToUtcDate } from 'src/common/utils/trade-date.util'
import { PrismaService } from 'src/shared/prisma.service'
import { CreateResearchNoteDto, ResearchNoteQueryDto, UpdateResearchNoteDto } from './dto/research-note.dto'

/** 每用户最大笔记数量（不含软删） */
const MAX_NOTES_PER_USER = 500

@Injectable()
export class ResearchNoteService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: number, query: ResearchNoteQueryDto) {
    const where: Prisma.ResearchNoteWhereInput = { userId }

    if (!query.includeDeleted) where.deletedAt = null
    if (query.tsCode) where.tsCode = query.tsCode
    if (query.tags?.length) where.tags = { hasEvery: query.tags }
    if (query.pinnedOnly) where.isPinned = true
    if (query.hasStock) where.tsCode = { not: null }
    if (query.since || query.until) {
      where.createdAt = {
        ...(query.since ? { gte: parseCompactTradeDateToUtcDate(query.since, 'since') } : {}),
        ...(query.until ? { lt: addUtcDays(parseCompactTradeDateToUtcDate(query.until, 'until'), 1) } : {}),
      }
    }
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

    return {
      notes: notes.map((n) => this.toNoteItem(n)),
      total,
      page,
      pageSize,
    }
  }

  async search(userId: number, keyword: string, page = 1, pageSize = 20) {
    // Sanitize: only allow plain text — strip any HTML tags to prevent XSS in highlights
    const safeKeyword = keyword.replace(/<[^>]*>/g, '').trim()
    if (!safeKeyword) return { items: [], total: 0, page, pageSize }

    const where: Prisma.ResearchNoteWhereInput = {
      userId,
      deletedAt: null,
      OR: [
        { title: { contains: safeKeyword, mode: 'insensitive' } },
        { content: { contains: safeKeyword, mode: 'insensitive' } },
      ],
    }

    const [notes, total] = await Promise.all([
      this.prisma.researchNote.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.researchNote.count({ where }),
    ])

    // Add <mark> highlights after escaping HTML — only <mark> tags are introduced by us.
    const items = notes.map((n) => {
      const re = new RegExp(`(${safeKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
      const titleHit = n.title.toLowerCase().includes(safeKeyword.toLowerCase()) ? 2 : 0
      const contentHit = n.content.toLowerCase().includes(safeKeyword.toLowerCase()) ? 1 : 0
      return {
        ...this.toNoteItem(n),
        snippetHtml: this.extractSnippet(n.content, safeKeyword, re),
        score: titleHit + contentHit,
      }
    })

    return { items, total, page, pageSize }
  }

  async listTrash(userId: number, page = 1, pageSize = 20) {
    const where: Prisma.ResearchNoteWhereInput = { userId, deletedAt: { not: null } }
    const [notes, total] = await Promise.all([
      this.prisma.researchNote.findMany({
        where,
        orderBy: { deletedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.researchNote.count({ where }),
    ])
    return { notes: notes.map((n) => this.toNoteItem(n)), total, page, pageSize }
  }

  async findOne(userId: number, id: number) {
    const note = await this.prisma.researchNote.findFirst({ where: { id, userId, deletedAt: null } })
    if (!note) throw new NotFoundException('笔记不存在')
    return this.toNoteItem(note)
  }

  async create(userId: number, dto: CreateResearchNoteDto) {
    const count = await this.prisma.researchNote.count({ where: { userId, deletedAt: null } })
    if (count >= MAX_NOTES_PER_USER) {
      throw new BadRequestException(`笔记数量已达上限（最多 ${MAX_NOTES_PER_USER} 条）`)
    }

    if (dto.tsCode) {
      const stockExists = await this.prisma.stockBasic.findFirst({ where: { tsCode: dto.tsCode } })
      if (!stockExists) throw new NotFoundException(`股票代码 ${dto.tsCode} 不存在`)
    }

    const note = await this.prisma.researchNote.create({
      data: {
        userId,
        tsCode: dto.tsCode ?? null,
        title: dto.title,
        content: dto.content,
        wordCount: dto.content.length,
        versionCount: 1,
        tags: dto.tags ?? [],
        isPinned: dto.isPinned ?? false,
      },
    })
    return this.toNoteItem(note)
  }

  async update(userId: number, id: number, dto: UpdateResearchNoteDto) {
    const note = await this.prisma.researchNote.findFirst({ where: { id, userId, deletedAt: null } })
    if (!note) throw new NotFoundException('笔记不存在')

    const updated = await this.prisma.researchNote.update({
      where: { id },
      data: {
        ...(dto.tsCode !== undefined && { tsCode: dto.tsCode }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content, wordCount: dto.content.length }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.isPinned !== undefined && { isPinned: dto.isPinned }),
        versionCount: { increment: 1 },
      },
    })
    return this.toNoteItem(updated)
  }

  /** 软删除 */
  async remove(userId: number, id: number) {
    const note = await this.prisma.researchNote.findFirst({ where: { id, userId, deletedAt: null } })
    if (!note) throw new NotFoundException('笔记不存在')

    await this.prisma.researchNote.update({ where: { id }, data: { deletedAt: new Date() } })
    return { message: '笔记已移入回收站' }
  }

  /** 从回收站恢复 */
  async restore(userId: number, id: number) {
    const note = await this.prisma.researchNote.findFirst({ where: { id, userId, deletedAt: { not: null } } })
    if (!note) throw new NotFoundException('笔记不存在或未删除')

    const updated = await this.prisma.researchNote.update({ where: { id }, data: { deletedAt: null } })
    return this.toNoteItem(updated)
  }

  /** 永久删除（不可恢复） */
  async permanentDelete(userId: number, id: number) {
    const note = await this.prisma.researchNote.findFirst({ where: { id, userId } })
    if (!note) throw new NotFoundException('笔记不存在')

    await this.prisma.researchNote.delete({ where: { id } })
    return { message: '笔记已永久删除' }
  }

  async getUserTags(userId: number): Promise<{ tags: Array<{ tag: string; count: number }> }> {
    const notes = await this.prisma.researchNote.findMany({
      where: { userId, deletedAt: null },
      select: { tags: true },
    })
    const counts = new Map<string, number>()
    for (const tag of notes.flatMap((n) => n.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    const tags = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag, 'zh-CN'))
    return { tags }
  }

  async findByStock(userId: number, tsCode: string) {
    const notes = await this.prisma.researchNote.findMany({
      where: { userId, tsCode, deletedAt: null },
      orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
    })
    return { notes: notes.map((n) => this.toNoteItem(n)), total: notes.length }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private toNoteItem(n: {
    id: number
    userId: number
    tsCode: string | null
    title: string
    content?: string | null
    tags: string[]
    isPinned: boolean
    wordCount?: number | null
    versionCount?: number | null
    deletedAt?: Date | null
    createdAt?: Date
    updatedAt?: Date
  }) {
    const content = n.content ?? ''
    return {
      ...n,
      wordCount: n.wordCount ?? content.length,
      versionCount: n.versionCount ?? 1,
      deletedAt: n.deletedAt?.toISOString() ?? null,
    }
  }

  private extractSnippet(content: string, keyword: string, re: RegExp): string {
    const idx = content.toLowerCase().indexOf(keyword.toLowerCase())
    if (idx === -1) return this.escapeHtml(content.slice(0, 100) + (content.length > 100 ? '…' : ''))
    const start = Math.max(0, idx - 40)
    const end = Math.min(content.length, idx + keyword.length + 60)
    const snippet = (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '')
    return this.escapeHtml(snippet).replace(re, '<mark>$1</mark>')
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
