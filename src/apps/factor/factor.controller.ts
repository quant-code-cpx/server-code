import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { FactorService } from './factor.service'
import { FactorDetailQueryDto, FactorLibraryQueryDto } from './dto/factor-library.dto'
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

@ApiTags('Factor - 因子市场')
@UseGuards(JwtAuthGuard)
@Controller('factor')
export class FactorController {
  constructor(private readonly factorService: FactorService) {}

  // ── Phase 1: Library & Values ────────────────────────────────────────────

  @Post('library')
  @ApiOperation({ summary: '因子库列表（按分类分组）' })
  getLibrary(@Body() dto: FactorLibraryQueryDto) {
    return this.factorService.getLibrary(dto)
  }

  @Post('detail')
  @ApiOperation({ summary: '因子详情' })
  getDetail(@Body() dto: FactorDetailQueryDto) {
    return this.factorService.getDetail(dto)
  }

  @Post('values')
  @ApiOperation({ summary: '因子截面值查询（指定因子在指定交易日的全市场值）' })
  getFactorValues(@Body() dto: FactorValuesQueryDto) {
    return this.factorService.getFactorValues(dto)
  }

  // ── Phase 2: Analysis ────────────────────────────────────────────────────

  @Post('analysis/ic')
  @ApiOperation({ summary: 'IC 时间序列分析（Spearman/Pearson 相关系数）' })
  getIcAnalysis(@Body() dto: FactorIcAnalysisDto) {
    return this.factorService.getIcAnalysis(dto)
  }

  @Post('analysis/quantile')
  @ApiOperation({ summary: '因子分层回测（各分位组累计收益）' })
  getQuantileAnalysis(@Body() dto: FactorQuantileAnalysisDto) {
    return this.factorService.getQuantileAnalysis(dto)
  }

  @Post('analysis/decay')
  @ApiOperation({ summary: '因子衰减分析（不同持有期 IC 对比）' })
  getDecayAnalysis(@Body() dto: FactorDecayAnalysisDto) {
    return this.factorService.getDecayAnalysis(dto)
  }

  @Post('analysis/distribution')
  @ApiOperation({ summary: '因子截面分布统计与直方图' })
  getDistribution(@Body() dto: FactorDistributionDto) {
    return this.factorService.getDistribution(dto)
  }

  @Post('analysis/correlation')
  @ApiOperation({ summary: '多因子相关性矩阵' })
  getCorrelation(@Body() dto: FactorCorrelationDto) {
    return this.factorService.getCorrelation(dto)
  }

  // ── Phase 3: Screening ───────────────────────────────────────────────────

  @Post('screening')
  @ApiOperation({ summary: '多因子选股（条件组合筛选）' })
  screening(@Body() dto: FactorScreeningDto) {
    return this.factorService.screening(dto)
  }

  // ── Phase 2 (Custom Factor Engine) ──────────────────────────────────────

  @Post('custom/create')
  @ApiOperation({ summary: '创建自定义因子（表达式引擎）' })
  createCustomFactor(@Body() dto: CreateCustomFactorDto) {
    return this.factorService.createCustomFactor(dto)
  }

  @Post('custom/test')
  @ApiOperation({ summary: '试算自定义因子表达式（不落库）' })
  testCustomFactor(@Body() dto: TestCustomFactorDto) {
    return this.factorService.testCustomFactor(dto)
  }

  @Put('custom/:name')
  @ApiOperation({ summary: '更新自定义因子' })
  updateCustomFactor(@Param('name') name: string, @Body() dto: UpdateCustomFactorDto) {
    return this.factorService.updateCustomFactor(name, dto)
  }

  @Delete('custom/:name')
  @ApiOperation({ summary: '删除自定义因子（同时清除预计算快照）' })
  deleteCustomFactor(@Param('name') name: string) {
    return this.factorService.deleteCustomFactor(name)
  }

  @Post('custom/:name/precompute')
  @ApiOperation({ summary: '触发单因子预计算' })
  triggerSinglePrecompute(@Param('name') name: string, @Body() dto: FactorPrecomputeTriggerDto) {
    return this.factorService.triggerSinglePrecompute(name, dto.tradeDate)
  }

  // ── Admin: Precompute (Phase 1) ──────────────────────────────────────────

  @Post('admin/precompute')
  @ApiOperation({ summary: '[管理] 手动触发指定日期的因子预计算' })
  triggerPrecompute(@Body() dto: FactorPrecomputeTriggerDto) {
    return this.factorService.triggerPrecompute(dto)
  }

  @Post('admin/backfill')
  @ApiOperation({ summary: '[管理] 触发历史因子值回补（指定日期范围）' })
  triggerBackfill(@Body() dto: FactorBackfillDto) {
    return this.factorService.triggerBackfill(dto)
  }

  @Get('admin/precompute/status')
  @ApiOperation({ summary: '[管理] 查询预计算状态（最新日期、各因子覆盖情况）' })
  getPrecomputeStatus() {
    return this.factorService.getPrecomputeStatus()
  }
}
