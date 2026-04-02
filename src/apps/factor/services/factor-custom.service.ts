import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { FactorCategory, FactorSourceType } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { CreateCustomFactorDto, TestCustomFactorDto, UpdateCustomFactorDto } from '../dto/factor-custom.dto'
import { FactorComputeService } from './factor-compute.service'
import { FactorExpressionService } from './factor-expression.service'
import { FactorPrecomputeService } from './factor-precompute.service'

/** Max custom factors a single user context can define */
const MAX_CUSTOM_FACTORS = 50

@Injectable()
export class FactorCustomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expressionSvc: FactorExpressionService,
    private readonly compute: FactorComputeService,
    private readonly precompute: FactorPrecomputeService,
  ) {}

  // ── Validate expression (no DB ops) ──────────────────────────────────────

  validateExpression(expression: string) {
    return this.expressionSvc.validate(expression)
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createCustomFactor(dto: CreateCustomFactorDto) {
    // 1. Validate expression syntax + security
    const validation = this.expressionSvc.validate(dto.expression)
    if (!validation.valid) {
      throw new BadRequestException(`表达式无效：${validation.errors.join('; ')}`)
    }

    // 2. Check name conflict
    const existing = await this.prisma.factorDefinition.findUnique({ where: { name: dto.name } })
    if (existing) {
      throw new ConflictException(`因子 "${dto.name}" 已存在`)
    }

    // 3. Check quota
    const customCount = await this.prisma.factorDefinition.count({
      where: { isBuiltin: false },
    })
    if (customCount >= MAX_CUSTOM_FACTORS) {
      throw new BadRequestException(`自定义因子数量已达上限（${MAX_CUSTOM_FACTORS} 个）`)
    }

    // 4. Parse to verify compilability (may throw if expression is compilable but has deeper issues)
    try {
      this.expressionSvc.parse(dto.expression)
    } catch (err) {
      throw new BadRequestException(`表达式解析失败：${(err as Error).message}`)
    }

    // 5. Create factor definition
    const factor = await this.prisma.factorDefinition.create({
      data: {
        name: dto.name,
        label: dto.label,
        description: dto.description,
        category: dto.category ?? FactorCategory.CUSTOM,
        sourceType: FactorSourceType.CUSTOM_SQL,
        expression: dto.expression,
        isBuiltin: false,
        isEnabled: true,
        sortOrder: 9999,
        params: dto.autoPrecompute ? { autoPrecompute: true } : undefined,
      },
    })

    return {
      ...factor,
      validationWarnings: validation.warnings,
    }
  }

  // ── Test (trial compute, no DB write) ────────────────────────────────────

  async testCustomFactor(dto: TestCustomFactorDto) {
    const startMs = Date.now()

    // Validate first
    const validation = this.expressionSvc.validate(dto.expression)
    if (!validation.valid) {
      throw new BadRequestException(`表达式无效：${validation.errors.join('; ')}`)
    }

    // Compile
    let ast
    try {
      ast = this.expressionSvc.parse(dto.expression)
    } catch (err) {
      throw new BadRequestException(`表达式解析失败：${(err as Error).message}`)
    }
    const compiled = this.expressionSvc.compile(ast, dto.tradeDate)

    // Execute using compute service custom path
    const values = await this.compute.computeCustomSqlForDate(dto.expression, dto.tradeDate, dto.universe)

    const executionTimeMs = Date.now() - startMs
    const valid = values.filter((v) => v.factorValue != null)

    return {
      tradeDate: dto.tradeDate,
      universe: dto.universe ?? null,
      stockCount: valid.length,
      sampleValues: valid.slice(0, 10).map((v) => ({ tsCode: v.tsCode, value: v.factorValue })),
      diagnostics: {
        compiledSql: compiled.sql,
        executionTimeMs,
        requiredTables: [...compiled.requiredTables],
        warnings: validation.warnings,
      },
    }
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateCustomFactor(name: string, dto: UpdateCustomFactorDto) {
    const factor = await this.prisma.factorDefinition.findUnique({ where: { name } })
    if (!factor) throw new NotFoundException(`因子 "${name}" 不存在`)
    if (factor.isBuiltin) throw new BadRequestException(`内置因子不可修改`)

    if (dto.expression !== undefined) {
      const validation = this.expressionSvc.validate(dto.expression)
      if (!validation.valid) {
        throw new BadRequestException(`表达式无效：${validation.errors.join('; ')}`)
      }
      try {
        this.expressionSvc.parse(dto.expression)
      } catch (err) {
        throw new BadRequestException(`表达式解析失败：${(err as Error).message}`)
      }
    }

    return this.prisma.factorDefinition.update({
      where: { name },
      data: {
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.expression !== undefined && { expression: dto.expression }),
        ...(dto.isEnabled !== undefined && { isEnabled: dto.isEnabled }),
        ...(dto.autoPrecompute !== undefined && {
          params: { autoPrecompute: dto.autoPrecompute },
        }),
      },
    })
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteCustomFactor(name: string) {
    const factor = await this.prisma.factorDefinition.findUnique({ where: { name } })
    if (!factor) throw new NotFoundException(`因子 "${name}" 不存在`)
    if (factor.isBuiltin) throw new BadRequestException(`内置因子不可删除`)

    // Remove precomputed snapshots
    await this.prisma.factorSnapshot.deleteMany({ where: { factorName: name } })
    await this.prisma.factorSnapshotSummary.deleteMany({ where: { factorName: name } })

    await this.prisma.factorDefinition.delete({ where: { name } })

    return { deleted: name }
  }

  // ── Trigger single factor precompute ─────────────────────────────────────

  async triggerSinglePrecompute(name: string, tradeDate: string) {
    const factor = await this.prisma.factorDefinition.findUnique({ where: { name } })
    if (!factor) throw new NotFoundException(`因子 "${name}" 不存在`)
    if (!factor.isEnabled) throw new BadRequestException(`因子 "${name}" 已禁用`)

    const rows = await this.precompute.computeAndStore(name, tradeDate)
    return { factorName: name, tradeDate, rowsStored: rows }
  }
}
