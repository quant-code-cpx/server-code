import { Injectable, NotFoundException } from '@nestjs/common'
import { FactorLibraryQueryDto, FactorDetailQueryDto } from './dto/factor-library.dto'
import { FactorValuesQueryDto } from './dto/factor-values.dto'
import {
  FactorCorrelationDto,
  FactorDecayAnalysisDto,
  FactorDistributionDto,
  FactorIcAnalysisDto,
  FactorQuantileAnalysisDto,
} from './dto/factor-analysis.dto'
import { FactorScreeningDto } from './dto/factor-screening.dto'
import { FactorBackfillDto, FactorPrecomputeTriggerDto } from './dto/factor-precompute.dto'
import { CreateCustomFactorDto, TestCustomFactorDto, UpdateCustomFactorDto } from './dto/factor-custom.dto'
import { FactorBacktestSubmitDto, FactorAttributionDto } from './dto/factor-backtest.dto'
import { SaveAsStrategyDto } from './dto/save-as-strategy.dto'
import { FactorOrthogonalizeDto, FamaMacBethDto } from './dto/factor-orthogonal.dto'
import { FactorLibraryService } from './services/factor-library.service'
import { FactorComputeService } from './services/factor-compute.service'
import { FactorAnalysisService } from './services/factor-analysis.service'
import { FactorScreeningService } from './services/factor-screening.service'
import { FactorPrecomputeService } from './services/factor-precompute.service'
import { FactorCustomService } from './services/factor-custom.service'
import { FactorBacktestService } from './services/factor-backtest.service'
import { FactorOrthogonalService } from './services/factor-orthogonal.service'
import { FactorOptimizationService } from './services/factor-optimization.service'
import { FactorOptimizationDto } from './dto/factor-optimization.dto'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class FactorService {
  constructor(
    private readonly library: FactorLibraryService,
    private readonly compute: FactorComputeService,
    private readonly analysis: FactorAnalysisService,
    private readonly screeningSvc: FactorScreeningService,
    private readonly precompute: FactorPrecomputeService,
    private readonly customSvc: FactorCustomService,
    private readonly backtestSvc: FactorBacktestService,
    private readonly orthogonalSvc: FactorOrthogonalService,
    private readonly optimizationSvc: FactorOptimizationService,
    private readonly prisma: PrismaService,
  ) {}

  getLibrary(dto: FactorLibraryQueryDto) {
    return this.library.getLibrary(dto)
  }

  getDetail(dto: FactorDetailQueryDto) {
    return this.library.getDetail(dto)
  }

  async getFactorValues(dto: FactorValuesQueryDto) {
    const factor = await this.prisma.factorDefinition.findUnique({
      where: { name: dto.factorName },
    })

    if (!factor) {
      throw new NotFoundException(`因子 "${dto.factorName}" 不存在`)
    }

    if (!factor.isEnabled) {
      throw new NotFoundException(`因子 "${dto.factorName}" 已禁用`)
    }

    return this.compute.getFactorValues(dto, factor.sourceType, factor.name)
  }

  // ── Phase 2: Analysis ────────────────────────────────────────────────────

  getIcAnalysis(dto: FactorIcAnalysisDto) {
    return this.analysis.getIcAnalysis(dto)
  }

  getQuantileAnalysis(dto: FactorQuantileAnalysisDto) {
    return this.analysis.getQuantileAnalysis(dto)
  }

  getDecayAnalysis(dto: FactorDecayAnalysisDto) {
    return this.analysis.getDecayAnalysis(dto)
  }

  getDistribution(dto: FactorDistributionDto) {
    return this.analysis.getDistribution(dto)
  }

  getCorrelation(dto: FactorCorrelationDto) {
    return this.analysis.getCorrelation(dto)
  }

  // ── Phase 3: Screening ───────────────────────────────────────────────────

  screening(dto: FactorScreeningDto) {
    return this.screeningSvc.screening(dto)
  }

  // ── Phase 2 (Custom Factor Engine) ──────────────────────────────────────

  createCustomFactor(dto: CreateCustomFactorDto) {
    return this.customSvc.createCustomFactor(dto)
  }

  testCustomFactor(dto: TestCustomFactorDto) {
    return this.customSvc.testCustomFactor(dto)
  }

  updateCustomFactor(name: string, dto: UpdateCustomFactorDto) {
    return this.customSvc.updateCustomFactor(name, dto)
  }

  deleteCustomFactor(name: string) {
    return this.customSvc.deleteCustomFactor(name)
  }

  triggerSinglePrecompute(name: string, tradeDate: string) {
    return this.customSvc.triggerSinglePrecompute(name, tradeDate)
  }

  // ── Admin: Precompute ────────────────────────────────────────────────────

  triggerPrecompute(dto: FactorPrecomputeTriggerDto) {
    return this.precompute.precomputeAllFactors(dto.tradeDate, dto.factorNames)
  }

  triggerBackfill(dto: FactorBackfillDto) {
    return this.precompute.backfill(dto.startDate, dto.endDate, {
      factorNames: dto.factorNames,
      skipExisting: dto.skipExisting,
    })
  }

  getPrecomputeStatus() {
    return this.precompute.getPrecomputeStatus()
  }

  // ── Phase 3: Factor → Backtest ────────────────────────────────────────────

  submitBacktest(dto: FactorBacktestSubmitDto, userId: number) {
    return this.backtestSvc.submitBacktest(dto, userId)
  }

  attribution(dto: FactorAttributionDto) {
    return this.backtestSvc.attribution(dto)
  }

  saveAsStrategy(dto: SaveAsStrategyDto, userId: number) {
    return this.backtestSvc.saveAsStrategy(dto, userId)
  }

  // ── Phase 4: Orthogonalization ────────────────────────────────────────────

  orthogonalize(dto: FactorOrthogonalizeDto) {
    return this.orthogonalSvc.orthogonalize(dto)
  }

  famaMacBeth(dto: FamaMacBethDto) {
    return this.orthogonalSvc.famaMacBeth(dto)
  }

  // ── Phase 4: Portfolio Optimization ──────────────────────────────────────

  optimize(dto: FactorOptimizationDto, userId: number) {
    return this.optimizationSvc.optimize(dto, userId)
  }
}
