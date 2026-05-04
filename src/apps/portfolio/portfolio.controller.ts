import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { PortfolioService } from './portfolio.service'
import { PortfolioRiskService } from './portfolio-risk.service'
import { RiskCheckService } from './risk-check.service'
import { BacktestPortfolioBridgeService } from './services/backtest-portfolio-bridge.service'
import { PortfolioPerformanceService } from './services/portfolio-performance.service'
import { PortfolioTradeLogService } from './services/portfolio-trade-log.service'
import { CreatePortfolioDto } from './dto/create-portfolio.dto'
import { UpdatePortfolioDto } from './dto/update-portfolio.dto'
import { AddHoldingDto } from './dto/add-holding.dto'
import { UpdateHoldingDto } from './dto/update-holding.dto'
import { PortfolioPnlHistoryDto } from './dto/portfolio-pnl.dto'
import { CreateRiskRuleDto, UpdateRiskRuleDto } from './dto/risk-rule.dto'
import { ApplyBacktestDto, ApplyBacktestResponseDto } from './dto/apply-backtest.dto'
import { RebalancePlanDto, RebalancePlanResponseDto } from './dto/rebalance-plan.dto'
import { RebalancePlanService } from './services/rebalance-plan.service'
import { PortfolioPerformanceDto, PortfolioPerformanceResponseDto } from './dto/portfolio-performance.dto'
import { DriftDetectionDto, DriftDetectionResponseDto } from 'src/apps/signal/dto/drift-detection.dto'
import { DriftDetectionService } from 'src/apps/signal/drift-detection.service'
import { TradeLogQueryDto, TradeLogSummaryDto } from './dto/trade-log.dto'
import {
  BetaAnalysisDto,
  HoldingItemDto,
  IndustryDistributionDto,
  MarketCapDistributionDto,
  PortfolioCreatedDto,
  PortfolioDetailDto,
  PortfolioListItemDto,
  PortfolioUpdatedDto,
  PositionConcentrationDto,
  PnlHistoryItemDto,
  PnlTodayDto,
  RiskCheckResultDto,
  RiskRuleDto,
  SuccessDto,
  ViolationRecordDto,
} from './dto/portfolio-response.dto'

@ApiTags('组合管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('portfolio')
export class PortfolioController {
  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly riskService: PortfolioRiskService,
    private readonly riskCheckService: RiskCheckService,
    private readonly bridgeService: BacktestPortfolioBridgeService,
    private readonly rebalancePlanService: RebalancePlanService,
    private readonly performanceService: PortfolioPerformanceService,
    private readonly driftDetectionService: DriftDetectionService,
    private readonly tradeLogService: PortfolioTradeLogService,
  ) {}

  // ─── 组合 CRUD ────────────────────────────────────────────────────────────

  @Post('create')
  @ApiOperation({ summary: '创建组合' })
  @ApiSuccessResponse(PortfolioCreatedDto)
  create(@CurrentUser() user: TokenPayload, @Body() dto: CreatePortfolioDto) {
    return this.portfolioService.create(user.id, dto)
  }

  @Post('list')
  @ApiOperation({ summary: '获取我的组合列表' })
  @ApiSuccessResponse(PortfolioListItemDto, { isArray: true })
  list(@CurrentUser() user: TokenPayload) {
    return this.portfolioService.list(user.id)
  }

  @Post('detail')
  @ApiOperation({ summary: '获取组合详情（含持仓估值）' })
  @ApiSuccessResponse(PortfolioDetailDto)
  detail(@CurrentUser() user: TokenPayload, @Body() body: { portfolioId: string }) {
    return this.portfolioService.detail(body.portfolioId, user.id)
  }

  @Post('update')
  @ApiOperation({ summary: '更新组合基本信息' })
  @ApiSuccessResponse(PortfolioUpdatedDto)
  update(@CurrentUser() user: TokenPayload, @Body() dto: UpdatePortfolioDto) {
    return this.portfolioService.update(dto, user.id)
  }

  @Post('delete')
  @ApiOperation({ summary: '删除组合' })
  @ApiSuccessResponse(SuccessDto)
  delete(@CurrentUser() user: TokenPayload, @Body() body: { portfolioId: string }) {
    return this.portfolioService.delete(body.portfolioId, user.id)
  }

  // ─── 持仓管理 ─────────────────────────────────────────────────────────────

  @Post('holding/add')
  @ApiOperation({ summary: '添加持仓（或加仓）' })
  @ApiSuccessResponse(HoldingItemDto)
  addHolding(@CurrentUser() user: TokenPayload, @Body() dto: AddHoldingDto) {
    return this.portfolioService.addHolding(dto, user.id)
  }

  @Post('holding/update')
  @ApiOperation({ summary: '更新持仓数量和成本' })
  @ApiSuccessResponse(HoldingItemDto)
  updateHolding(@CurrentUser() user: TokenPayload, @Body() dto: UpdateHoldingDto) {
    return this.portfolioService.updateHolding(dto, user.id)
  }

  @Post('holding/remove')
  @ApiOperation({ summary: '删除持仓' })
  @ApiSuccessResponse(SuccessDto)
  removeHolding(@CurrentUser() user: TokenPayload, @Body() body: { holdingId: string }) {
    return this.portfolioService.removeHolding(body.holdingId, user.id)
  }

  // ─── 盈亏分析 ─────────────────────────────────────────────────────────────

  @Post('pnl/today')
  @ApiOperation({ summary: '当日浮动盈亏' })
  @ApiSuccessResponse(PnlTodayDto)
  getPnlToday(@CurrentUser() user: TokenPayload, @Body() body: { portfolioId: string }) {
    return this.portfolioService.getPnlToday(body.portfolioId, user.id)
  }

  @Post('pnl/history')
  @ApiOperation({ summary: '历史净值曲线' })
  @ApiSuccessResponse(PnlHistoryItemDto, { isArray: true })
  getPnlHistory(@CurrentUser() user: TokenPayload, @Body() dto: PortfolioPnlHistoryDto) {
    return this.portfolioService.getPnlHistory(dto, user.id)
  }

  // ─── 风险分析 ─────────────────────────────────────────────────────────────

  @Post('risk/industry')
  @ApiOperation({ summary: '行业分布分析' })
  @ApiSuccessResponse(IndustryDistributionDto)
  getIndustryDistribution(@CurrentUser() user: TokenPayload, @Body() body: { portfolioId: string }) {
    return this.riskService.getIndustryDistribution(body.portfolioId, user.id)
  }

  @Post('risk/position')
  @ApiOperation({ summary: '仓位集中度分析' })
  @ApiSuccessResponse(PositionConcentrationDto)
  getPositionConcentration(@CurrentUser() user: TokenPayload, @Body() body: { portfolioId: string }) {
    return this.riskService.getPositionConcentration(body.portfolioId, user.id)
  }

  @Post('risk/market-cap')
  @ApiOperation({ summary: '市值分布分析' })
  @ApiSuccessResponse(MarketCapDistributionDto)
  getMarketCapDistribution(@CurrentUser() user: TokenPayload, @Body() body: { portfolioId: string }) {
    return this.riskService.getMarketCapDistribution(body.portfolioId, user.id)
  }

  @Post('risk/beta')
  @ApiOperation({ summary: 'Beta 系数分析' })
  @ApiSuccessResponse(BetaAnalysisDto)
  getBetaAnalysis(@CurrentUser() user: TokenPayload, @Body() body: { portfolioId: string }) {
    return this.riskService.getBetaAnalysis(body.portfolioId, user.id)
  }

  @Post('risk/snapshot')
  @ApiOperation({ summary: '风险快照（一次返回行业/持仓/市值/Beta，单维度失败不影响其他）' })
  getRiskSnapshot(@CurrentUser() user: TokenPayload, @Body() body: { portfolioId: string }) {
    return this.riskService.getRiskSnapshot(body.portfolioId, user.id)
  }

  // ─── 风控规则管理 ─────────────────────────────────────────────────────────

  @Post('rule/list')
  @ApiOperation({ summary: '获取风控规则列表' })
  @ApiSuccessResponse(RiskRuleDto, { isArray: true })
  listRules(@CurrentUser() user: TokenPayload, @Body() body: { portfolioId: string }) {
    return this.riskCheckService.listRules(body.portfolioId, user.id)
  }

  @Post('rule/upsert')
  @ApiOperation({ summary: '创建或更新风控规则' })
  @ApiSuccessResponse(RiskRuleDto)
  upsertRule(@CurrentUser() user: TokenPayload, @Body() dto: CreateRiskRuleDto) {
    return this.riskCheckService.upsertRule(dto, user.id)
  }

  @Post('rule/update')
  @ApiOperation({ summary: '修改风控规则阈值/启用状态' })
  @ApiSuccessResponse(RiskRuleDto)
  updateRule(@CurrentUser() user: TokenPayload, @Body() dto: UpdateRiskRuleDto) {
    return this.riskCheckService.updateRule(dto, user.id)
  }

  @Post('rule/delete')
  @ApiOperation({ summary: '删除风控规则' })
  @ApiSuccessResponse(SuccessDto)
  deleteRule(@CurrentUser() user: TokenPayload, @Body() body: { ruleId: string }) {
    return this.riskCheckService.deleteRule(body.ruleId, user.id)
  }

  // ─── 风险检测 ─────────────────────────────────────────────────────────────

  @Post('risk/check')
  @ApiOperation({ summary: '执行风控规则检测' })
  @ApiSuccessResponse(RiskCheckResultDto)
  runCheck(@CurrentUser() user: TokenPayload, @Body() body: { portfolioId: string }) {
    return this.riskCheckService.runCheck(body.portfolioId, user.id)
  }

  @Post('risk/violations')
  @ApiOperation({ summary: '查询历史违规记录' })
  @ApiSuccessResponse(ViolationRecordDto, { isArray: true })
  listViolations(@CurrentUser() user: TokenPayload, @Body() body: { portfolioId: string; limit?: number }) {
    return this.riskCheckService.listViolations(body.portfolioId, user.id, body.limit)
  }

  // ─── 回测导入 ──────────────────────────────────────────────────────────────

  @Post('apply-backtest')
  @ApiOperation({ summary: '将回测末日持仓导入组合（REPLACE 清空替换 / MERGE 合并加仓）' })
  @ApiSuccessResponse(ApplyBacktestResponseDto)
  applyBacktest(@CurrentUser() user: TokenPayload, @Body() dto: ApplyBacktestDto) {
    return this.bridgeService.applyBacktest(dto, user.id)
  }

  // ─── 调仓清单 ──────────────────────────────────────────────────────────────

  @Post('rebalance-plan')
  @ApiOperation({ summary: '生成调仓清单（纯计算，不写库；含整手约束 / 停牌跳过 / 成本估算）' })
  @ApiSuccessResponse(RebalancePlanResponseDto)
  rebalancePlan(@CurrentUser() user: TokenPayload, @Body() dto: RebalancePlanDto) {
    return this.rebalancePlanService.rebalancePlan(dto, user.id)
  }

  // ─── 绩效跟踪 ──────────────────────────────────────────────────────────────

  @Post('performance')
  @ApiOperation({ summary: '组合绩效跟踪（净值曲线 vs 基准对比，含超额收益 / 跟踪误差 / 信息比率）' })
  @ApiSuccessResponse(PortfolioPerformanceResponseDto)
  getPerformance(@CurrentUser() user: TokenPayload, @Body() dto: PortfolioPerformanceDto) {
    return this.performanceService.getPerformance(dto, user.id)
  }

  // ─── 策略漂移检测 ──────────────────────────────────────────────────────────

  @Post('drift-detection')
  @ApiOperation({ summary: '策略漂移检测（对比当前持仓与最新信号的偏离度）' })
  @ApiSuccessResponse(DriftDetectionResponseDto)
  detectDrift(@CurrentUser() user: TokenPayload, @Body() dto: DriftDetectionDto) {
    return this.driftDetectionService.detect(dto, user.id)
  }

  // ─── 交易日志 ──────────────────────────────────────────────────────────────

  @Post('trade-log')
  @ApiOperation({ summary: '查询组合交易日志（分页）' })
  queryTradeLog(@CurrentUser() user: TokenPayload, @Body() dto: TradeLogQueryDto) {
    return this.tradeLogService.query(dto, user.id)
  }

  @Post('trade-log/summary')
  @ApiOperation({ summary: '交易日志按维度汇总' })
  tradeLogSummary(@CurrentUser() user: TokenPayload, @Body() dto: TradeLogSummaryDto) {
    return this.tradeLogService.summary(dto, user.id)
  }
}
