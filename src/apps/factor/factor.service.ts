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
import { FactorLibraryService } from './services/factor-library.service'
import { FactorComputeService } from './services/factor-compute.service'
import { FactorAnalysisService } from './services/factor-analysis.service'
import { FactorScreeningService } from './services/factor-screening.service'
import { FactorPrecomputeService } from './services/factor-precompute.service'
import { PrismaService } from 'src/shared/prisma.service'

@Injectable()
export class FactorService {
  constructor(
    private readonly library: FactorLibraryService,
    private readonly compute: FactorComputeService,
    private readonly analysis: FactorAnalysisService,
    private readonly screeningSvc: FactorScreeningService,
    private readonly precompute: FactorPrecomputeService,
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
}
