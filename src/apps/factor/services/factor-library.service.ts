import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common'
import { FactorCategory, Prisma } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { BUILTIN_FACTORS, CATEGORY_LABEL_MAP } from '../constants/builtin-factors.constant'
import { FactorDetailQueryDto, FactorLibraryQueryDto } from '../dto/factor-library.dto'
import { FactorCategoryGroup } from '../types/factor.types'

@Injectable()
export class FactorLibraryService implements OnModuleInit {
  private readonly logger = new Logger(FactorLibraryService.name)

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedBuiltinFactors()
  }

  /** 启动时幂等写入内置因子定义 */
  async seedBuiltinFactors(): Promise<void> {
    try {
      for (const factor of BUILTIN_FACTORS) {
        await this.prisma.factorDefinition.upsert({
          where: { name: factor.name },
          create: {
            name: factor.name,
            label: factor.label,
            description: factor.description,
            category: factor.category,
            sourceType: factor.sourceType,
            expression: factor.expression ?? null,
            sourceTable: factor.sourceTable ?? null,
            sourceField: factor.sourceField ?? null,
            params: (factor.params as Prisma.InputJsonValue | undefined) ?? undefined,
            isEnabled: true,
            sortOrder: factor.sortOrder,
          },
          update: {
            label: factor.label,
            description: factor.description,
            category: factor.category,
            sourceType: factor.sourceType,
            expression: factor.expression ?? null,
            sourceTable: factor.sourceTable ?? null,
            sourceField: factor.sourceField ?? null,
            params: (factor.params as Prisma.InputJsonValue | undefined) ?? undefined,
            sortOrder: factor.sortOrder,
          },
        })
      }
      this.logger.log(`内置因子 seed 完成，共 ${BUILTIN_FACTORS.length} 个`)
    } catch (error) {
      this.logger.error('内置因子 seed 失败', (error as Error).message)
    }
  }

  /** 获取因子库列表，按分类分组 */
  async getLibrary(dto: FactorLibraryQueryDto): Promise<{ categories: FactorCategoryGroup[] }> {
    const where: Parameters<typeof this.prisma.factorDefinition.findMany>[0]['where'] = {}
    if (dto.category) where.category = dto.category
    if (dto.enabledOnly !== false) where.isEnabled = true

    const factors = await this.prisma.factorDefinition.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    })

    const grouped = new Map<FactorCategory, FactorCategoryGroup>()

    for (const f of factors) {
      if (!grouped.has(f.category)) {
        grouped.set(f.category, {
          category: f.category,
          label: CATEGORY_LABEL_MAP[f.category] ?? f.category,
          factors: [],
        })
      }
      grouped.get(f.category)!.factors.push({
        id: f.id,
        name: f.name,
        label: f.label,
        description: f.description,
        category: f.category,
        sourceType: f.sourceType,
        isBuiltin: f.isBuiltin,
        isEnabled: f.isEnabled,
        sortOrder: f.sortOrder,
      })
    }

    return { categories: Array.from(grouped.values()) }
  }

  /** 获取单个因子详情 */
  async getDetail(dto: FactorDetailQueryDto) {
    const factor = await this.prisma.factorDefinition.findUnique({
      where: { name: dto.factorName },
    })

    if (!factor) {
      throw new NotFoundException(`因子 "${dto.factorName}" 不存在`)
    }

    return {
      id: factor.id,
      name: factor.name,
      label: factor.label,
      description: factor.description,
      category: factor.category,
      sourceType: factor.sourceType,
      sourceTable: factor.sourceTable,
      sourceField: factor.sourceField,
      expression: factor.expression,
      params: factor.params,
      isBuiltin: factor.isBuiltin,
      isEnabled: factor.isEnabled,
      sortOrder: factor.sortOrder,
      createdAt: factor.createdAt,
      updatedAt: factor.updatedAt,
    }
  }
}
