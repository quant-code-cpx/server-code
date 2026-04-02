import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { BacktestRunService } from './services/backtest-run.service'
import { BacktestStrategyRegistryService } from './services/backtest-strategy-registry.service'
import { BacktestWalkForwardService } from './services/backtest-walk-forward.service'
import { BacktestComparisonService } from './services/backtest-comparison.service'
import { BacktestMonteCarloService } from './services/backtest-monte-carlo.service'
import { CreateBacktestRunDto } from './dto/create-backtest-run.dto'
import { ValidateBacktestRunDto } from './dto/backtest-validate.dto'
import { ListBacktestRunsDto } from './dto/list-backtest-runs.dto'
import { BacktestTradeQueryDto } from './dto/backtest-trade-query.dto'
import { BacktestPositionQueryDto } from './dto/backtest-position-query.dto'
import {
  CreateWalkForwardRunDto,
  CreateWalkForwardRunResponseDto,
  WalkForwardEquityDto,
  WalkForwardRunDetailDto,
  WalkForwardRunListDto,
} from './dto/walk-forward.dto'
import {
  BacktestComparisonEquityDto,
  BacktestComparisonGroupDetailDto,
  CreateBacktestComparisonDto,
  CreateBacktestComparisonResponseDto,
} from './dto/backtest-comparison.dto'
import { CreateRollingBacktestDto } from './dto/rolling-backtest.dto'
import { RunMonteCarloDto, MonteCarloResultDto } from './dto/monte-carlo.dto'
import {
  BacktestEquityResponseDto,
  BacktestPositionResponseDto,
  BacktestRunDetailResponseDto,
  BacktestRunListResponseDto,
  BacktestTradeListResponseDto,
  CancelBacktestRunResponseDto,
  CreateBacktestRunResponseDto,
  StrategyTemplateListResponseDto,
  ValidateBacktestRunResponseDto,
} from './dto/backtest-response.dto'

@ApiTags('Backtest - 策略回测')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('backtests')
export class BacktestController {
  constructor(
    private readonly runService: BacktestRunService,
    private readonly strategyRegistry: BacktestStrategyRegistryService,
    private readonly walkForwardService: BacktestWalkForwardService,
    private readonly comparisonService: BacktestComparisonService,
    private readonly monteCarloService: BacktestMonteCarloService,
  ) {}

  @Post('strategy-templates')
  @ApiOperation({ summary: '获取内置策略模板列表' })
  @ApiSuccessResponse(StrategyTemplateListResponseDto)
  getStrategyTemplates() {
    return this.strategyRegistry.getTemplates()
  }

  @Post('runs/validate')
  @ApiOperation({ summary: '验证回测配置合法性和数据完备性' })
  @ApiSuccessResponse(ValidateBacktestRunResponseDto)
  validateRun(@Body() dto: ValidateBacktestRunDto) {
    return this.runService.validateRun(dto)
  }

  @Post('runs')
  @ApiOperation({ summary: '创建回测任务' })
  @ApiSuccessResponse(CreateBacktestRunResponseDto)
  createRun(@Body() dto: CreateBacktestRunDto, @CurrentUser() user: TokenPayload) {
    return this.runService.createRun(dto, user.id)
  }

  @Post('runs/list')
  @ApiOperation({ summary: '查询回测历史列表' })
  @ApiSuccessResponse(BacktestRunListResponseDto)
  listRuns(@Body() dto: ListBacktestRunsDto, @CurrentUser() user: TokenPayload) {
    return this.runService.listRuns(dto, user.id)
  }

  @Post('runs/detail')
  @ApiOperation({ summary: '获取回测详情' })
  @ApiSuccessResponse(BacktestRunDetailResponseDto)
  getRunDetail(@Body() { runId }: { runId: string }) {
    return this.runService.getRunDetail(runId)
  }

  @Post('runs/equity')
  @ApiOperation({ summary: '获取日度净值曲线' })
  @ApiSuccessResponse(BacktestEquityResponseDto)
  getEquity(@Body() { runId }: { runId: string }) {
    return this.runService.getEquity(runId)
  }

  @Post('runs/trades')
  @ApiOperation({ summary: '分页查询交易明细' })
  @ApiSuccessResponse(BacktestTradeListResponseDto)
  getTrades(@Body() dto: BacktestTradeQueryDto & { runId: string }) {
    return this.runService.getTrades(dto.runId, dto)
  }

  @Post('runs/positions')
  @ApiOperation({ summary: '查询持仓快照' })
  @ApiSuccessResponse(BacktestPositionResponseDto)
  getPositions(@Body() dto: BacktestPositionQueryDto & { runId: string }) {
    return this.runService.getPositions(dto.runId, dto)
  }

  @Post('runs/cancel')
  @ApiOperation({ summary: '取消回测任务' })
  @ApiSuccessResponse(CancelBacktestRunResponseDto)
  cancelRun(@Body() { runId }: { runId: string }) {
    return this.runService.cancelRun(runId)
  }

  @Post('runs/monte-carlo')
  @ApiOperation({ summary: '对已完成回测运行蒙特卡洛模拟' })
  @ApiSuccessResponse(MonteCarloResultDto)
  runMonteCarlo(@Body() dto: RunMonteCarloDto & { runId: string }) {
    return this.monteCarloService.runMonteCarloSimulation(dto.runId, dto)
  }

  // ── Walk-Forward ────────────────────────────────────────────────────────────

  @Post('walk-forward/runs')
  @ApiOperation({ summary: '创建 Walk-Forward 滚动验证任务' })
  @ApiSuccessResponse(CreateWalkForwardRunResponseDto)
  createWalkForwardRun(@Body() dto: CreateWalkForwardRunDto, @CurrentUser() user: TokenPayload) {
    return this.walkForwardService.createWalkForwardRun(dto, user.id)
  }

  @Post('walk-forward/runs/list')
  @ApiOperation({ summary: 'Walk-Forward 验证列表（分页）' })
  @ApiSuccessResponse(WalkForwardRunListDto)
  listWalkForwardRuns(@Body() dto: { page?: number; pageSize?: number }, @CurrentUser() user: TokenPayload) {
    return this.walkForwardService.listWalkForwardRuns(user.id, dto.page, dto.pageSize)
  }

  @Post('walk-forward/runs/detail')
  @ApiOperation({ summary: 'Walk-Forward 验证详情（含各窗口 IS/OOS 指标）' })
  @ApiSuccessResponse(WalkForwardRunDetailDto)
  getWalkForwardRunDetail(@Body() { wfRunId }: { wfRunId: string }) {
    return this.walkForwardService.getWalkForwardRunDetail(wfRunId)
  }

  @Post('walk-forward/runs/equity')
  @ApiOperation({ summary: '拼接后的 OOS 净値曲线' })
  @ApiSuccessResponse(WalkForwardEquityDto)
  getWalkForwardEquity(@Body() { wfRunId }: { wfRunId: string }) {
    return this.walkForwardService.getWalkForwardEquity(wfRunId)
  }

  // ── Multi-strategy comparison ────────────────────────────────────────────────

  @Post('comparisons')
  @ApiOperation({ summary: '创建多策略对比回测组' })
  @ApiSuccessResponse(CreateBacktestComparisonResponseDto)
  createComparison(@Body() dto: CreateBacktestComparisonDto, @CurrentUser() user: TokenPayload) {
    return this.comparisonService.createComparison(dto, user.id)
  }

  @Post('comparisons/detail')
  @ApiOperation({ summary: '获取对比组详情（含各策略指标对比）' })
  @ApiSuccessResponse(BacktestComparisonGroupDetailDto)
  getComparisonDetail(@Body() { groupId }: { groupId: string }) {
    return this.comparisonService.getComparisonDetail(groupId)
  }

  @Post('comparisons/equity')
  @ApiOperation({ summary: '所有策略的净値曲线叠加数据' })
  @ApiSuccessResponse(BacktestComparisonEquityDto)
  getComparisonEquity(@Body() { groupId }: { groupId: string }) {
    return this.comparisonService.getComparisonEquity(groupId)
  }

  // ── Rolling backtest ─────────────────────────────────────────────────────────

  @Post('rolling/runs')
  @ApiOperation({ summary: '创建滚动窗口回测（内部转化为 Walk-Forward 任务）' })
  @ApiSuccessResponse(CreateWalkForwardRunResponseDto)
  createRollingBacktest(@Body() dto: CreateRollingBacktestDto, @CurrentUser() user: TokenPayload) {
    // Transform to Walk-Forward request: inSampleDays=lookbackDays, stepDays=holdingPeriodDays
    const wfDto: CreateWalkForwardRunDto = {
      name: dto.name,
      baseStrategyType: dto.strategyType,
      baseStrategyConfig: dto.strategyConfig,
      paramSearchSpace: dto.rollingParamSpace,
      fullStartDate: dto.startDate,
      fullEndDate: dto.endDate,
      inSampleDays: dto.lookbackDays,
      outOfSampleDays: dto.holdingPeriodDays,
      stepDays: dto.holdingPeriodDays, // no overlap
      optimizeMetric: dto.optimizeMetric ?? 'sharpeRatio',
      benchmarkTsCode: dto.benchmarkTsCode,
      universe: dto.universe,
      initialCapital: dto.initialCapital,
      rebalanceFrequency: dto.rebalanceFrequency,
    }
    return this.walkForwardService.createWalkForwardRun(wfDto, user.id)
  }
}
