import { Body, Controller, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { StockService } from './stock.service'
import { StockAnalysisService } from './stock-analysis.service'
import { StockListQueryDto } from './dto/stock-list-query.dto'
import { StockDetailDto } from './dto/stock-detail.dto'
import { StockSearchDto } from './dto/stock-search.dto'
import { StockDetailChartDto } from './dto/stock-detail-chart.dto'
import { StockDetailMoneyFlowDto } from './dto/stock-detail-money-flow.dto'
import { StockDetailFinancialsDto } from './dto/stock-detail-financials.dto'
import { StockDetailShareholdersDto } from './dto/stock-detail-shareholders.dto'
import { StockDetailShareCapitalDto } from './dto/stock-detail-share-capital.dto'
import { StockDetailFinancingDto } from './dto/stock-detail-financing.dto'
import { StockDetailFinancialStatementsDto } from './dto/stock-detail-financial-statements.dto'
import { StockScreenerQueryDto } from './dto/stock-screener-query.dto'
import { CreateScreenerStrategyDto, UpdateScreenerStrategyDto } from './dto/stock-screener-strategy.dto'
import { StockConceptsDto } from './dto/stock-concepts.dto'
import {
  StockTechnicalIndicatorsDto,
  StockTimingSignalsDto,
  StockChipDistributionDto,
  StockMarginQueryDto,
  StockRelativeStrengthDto,
  StockTechnicalFactorsQueryDto,
  StockLatestFactorsQueryDto,
} from './dto/stock-analysis-request.dto'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import {
  StockChartDataDto,
  StockDetailLegacyDataDto,
  StockDetailOverviewDataDto,
  StockFinancialsDataDto,
  StockFinancialStatementsDataDto,
  StockFinancingDataDto,
  StockListDataDto,
  StockListSummaryDataDto,
  StockMainMoneyFlowDataDto,
  StockMoneyFlowDataDto,
  StockScreenerDataDto,
  IndustryListDataDto,
  AreaListDataDto,
  ScreenerPresetDataDto,
  ScreenerStrategyDataDto,
  ScreenerStrategyDeleteDataDto,
  ScreenerStrategyListDataDto,
  ScreenerConceptListDataDto,
  StockSearchItemDto,
  StockShareCapitalDataDto,
  StockShareholdersDataDto,
  StockTodayFlowDataDto,
  StockTechnicalDataDto,
  StockTimingSignalsDataDto,
  ChipDistributionDataDto,
  StockMarginDataResponseDto,
  StockRelativeStrengthDataDto,
  StockConceptsDataDto,
  StockTechnicalFactorsDataDto,
  StockLatestFactorsDataDto,
} from './dto/stock-response.dto'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'

@ApiTags('Stock - 股票')
@Controller('stock')
export class StockController {
  constructor(
    private readonly stockService: StockService,
    private readonly stockAnalysisService: StockAnalysisService,
  ) {}

  @Post('list')
  @ApiOperation({ summary: '股票列表（分页 + 多维筛选 + 排序）' })
  @ApiSuccessResponse(StockListDataDto)
  findAll(@Body() query: StockListQueryDto) {
    return this.stockService.findAll(query)
  }

  @Post('list/summary')
  @ApiOperation({ summary: '股票列表摘要（最新交易日 / 涨跌平数 / 成交额 / 数据新鲜度）' })
  @ApiSuccessResponse(StockListSummaryDataDto)
  getListSummary(@Body() query: StockListQueryDto) {
    return this.stockService.getListSummary(query)
  }

  @Post('search')
  @ApiOperation({ summary: '股票搜索建议（联想词）' })
  @ApiSuccessResponse(StockSearchItemDto, { isArray: true })
  search(@Body() dto: StockSearchDto) {
    return this.stockService.search(dto)
  }

  @Post('detail')
  @ApiOperation({ summary: '获取股票详情（旧接口，兼容保留）' })
  @ApiSuccessResponse(StockDetailLegacyDataDto)
  findOne(@Body() { code }: StockDetailDto) {
    return this.stockService.findOne(code)
  }

  @Post('detail/overview')
  @ApiOperation({ summary: '股票详情 - 总览（基本信息 + 公司简介 + 最新行情 + 估值 + 状态）' })
  @ApiSuccessResponse(StockDetailOverviewDataDto)
  detailOverview(@Body() { code, tradeDate }: StockDetailDto) {
    return this.stockService.getDetailOverview(code, tradeDate)
  }

  @Post('detail/chart')
  @ApiOperation({ summary: '股票详情 - K 线图（支持日/周/月 + 前/后复权）' })
  @ApiSuccessResponse(StockChartDataDto)
  detailChart(@Body() dto: StockDetailChartDto) {
    return this.stockService.getDetailChart(dto)
  }

  @Post('detail/money-flow')
  @ApiOperation({ summary: '股票详情 - 资金流（最近 N 日资金流向）' })
  @ApiSuccessResponse(StockMoneyFlowDataDto)
  detailMoneyFlow(@Body() dto: StockDetailMoneyFlowDto) {
    return this.stockService.getDetailMoneyFlow(dto)
  }

  @Post('detail/financials')
  @ApiOperation({ summary: '股票详情 - 财务指标（最近 N 个报告期）' })
  @ApiSuccessResponse(StockFinancialsDataDto)
  detailFinancials(@Body() dto: StockDetailFinancialsDto) {
    return this.stockService.getDetailFinancials(dto)
  }

  @Post('detail/shareholders')
  @ApiOperation({ summary: '股票详情 - 十大股东（前十大股东 + 前十大流通股东，按持股数量降序）' })
  @ApiSuccessResponse(StockShareholdersDataDto)
  detailShareholders(@Body() dto: StockDetailShareholdersDto) {
    return this.stockService.getDetailShareholders(dto)
  }

  // dividend-financing endpoint removed (allotment logic deleted)

  @Post('detail/main-money-flow')
  @ApiOperation({ summary: '股票详情 - 主力资金流向（超大单+大单净流入 vs 散户净流入）' })
  @ApiSuccessResponse(StockMainMoneyFlowDataDto)
  detailMainMoneyFlow(@Body() dto: StockDetailMoneyFlowDto) {
    return this.stockService.getDetailMainMoneyFlow(dto)
  }

  @Post('detail/share-capital')
  @ApiOperation({ summary: '股票详情 - 股本结构（总股本/流通股本/限售股 + 历史变化）' })
  @ApiSuccessResponse(StockShareCapitalDataDto)
  detailShareCapital(@Body() dto: StockDetailShareCapitalDto) {
    return this.stockService.getDetailShareCapital(dto)
  }

  @Post('detail/financing')
  @ApiOperation({ summary: '股票详情 - 融资记录（配股等历史融资事件）' })
  @ApiSuccessResponse(StockFinancingDataDto)
  detailFinancing(@Body() dto: StockDetailFinancingDto) {
    return this.stockService.getDetailFinancing(dto)
  }

  @Post('detail/today-flow')
  @ApiOperation({ summary: '股票详情 - 今日资金流（超大单/大单/中单/小单/主力合计）' })
  @ApiSuccessResponse(StockTodayFlowDataDto)
  detailTodayFlow(@Body() { code }: StockDetailDto) {
    return this.stockService.getDetailTodayFlow(code)
  }

  @Post('detail/financial-statements')
  @ApiOperation({ summary: '股票详情 - 三大财务报表（利润表/资产负债表/现金流量表，含同比）' })
  @ApiSuccessResponse(StockFinancialStatementsDataDto)
  detailFinancialStatements(@Body() dto: StockDetailFinancialStatementsDto) {
    return this.stockService.getDetailFinancialStatements(dto)
  }

  // ─── 分析 Tab ────────────────────────────────────────────────────────────────

  @Post('detail/analysis/technical')
  @ApiOperation({ summary: '股票详情 - 分析 Tab：技术指标（MACD/KDJ/RSI/BOLL 等全套指标历史序列）' })
  @ApiSuccessResponse(StockTechnicalDataDto)
  getTechnicalIndicators(@Body() dto: StockTechnicalIndicatorsDto) {
    return this.stockAnalysisService.getTechnicalIndicators(dto)
  }

  @Post('detail/analysis/timing-signals')
  @ApiOperation({ summary: '股票详情 - 分析 Tab：择时信号（综合多指标买卖信号 + 评分）' })
  @ApiSuccessResponse(StockTimingSignalsDataDto)
  getTimingSignals(@Body() dto: StockTimingSignalsDto) {
    return this.stockAnalysisService.getTimingSignals(dto)
  }

  @Post('detail/analysis/chip-distribution')
  @ApiOperation({ summary: '股票详情 - 分析 Tab：筹码分布（真实 cyq 数据或估算）' })
  @ApiSuccessResponse(ChipDistributionDataDto)
  getChipDistribution(@Body() dto: StockChipDistributionDto) {
    return this.stockAnalysisService.getChipDistribution(dto)
  }

  @Post('detail/analysis/margin')
  @ApiOperation({ summary: '股票详情 - 分析 Tab：融资融券余额趋势（需 Tushare 2000 积分）' })
  @ApiSuccessResponse(StockMarginDataResponseDto)
  getMarginData(@Body() dto: StockMarginQueryDto) {
    return this.stockAnalysisService.getMarginData(dto)
  }

  @Post('detail/analysis/relative-strength')
  @ApiOperation({ summary: '股票详情 - 分析 Tab：相对强弱（个股 vs 大盘/行业指数）' })
  @ApiSuccessResponse(StockRelativeStrengthDataDto)
  getRelativeStrength(@Body() dto: StockRelativeStrengthDto) {
    return this.stockAnalysisService.getRelativeStrength(dto)
  }

  @Post('detail/analysis/factors')
  @ApiOperation({ summary: '股票详情 - 分析 Tab：预计算技术因子序列（MACD/KDJ/RSI/BOLL 等，直接读取数据库）' })
  @ApiSuccessResponse(StockTechnicalFactorsDataDto)
  getTechnicalFactors(@Body() dto: StockTechnicalFactorsQueryDto) {
    return this.stockAnalysisService.getTechnicalFactors(dto)
  }

  @Post('detail/analysis/factors/latest')
  @ApiOperation({ summary: '股票详情 - 分析 Tab：最新技术因子快照（含信号判断）' })
  @ApiSuccessResponse(StockLatestFactorsDataDto)
  getLatestFactors(@Body() dto: StockLatestFactorsQueryDto) {
    return this.stockAnalysisService.getLatestFactors(dto)
  }

  @Post('detail/concepts')
  @ApiOperation({ summary: '查询个股所属的同花顺概念板块列表' })
  @ApiSuccessResponse(StockConceptsDataDto)
  getStockConcepts(@Body() dto: StockConceptsDto) {
    return this.stockService.getStockConcepts(dto.tsCode)
  }

  // ─── 选股器 ─────────────────────────────────────────────────────────────────

  @Post('screener')
  @ApiOperation({ summary: '选股器 - 多维度条件筛选' })
  @ApiSuccessResponse(StockScreenerDataDto)
  screener(@Body() dto: StockScreenerQueryDto) {
    return this.stockService.screener(dto)
  }

  @Post('screener/presets')
  @ApiOperation({ summary: '选股器 - 内置筛选条件预设列表' })
  @ApiSuccessResponse(ScreenerPresetDataDto)
  screenerPresets() {
    return this.stockService.getScreenerPresets()
  }

  @Post('screener/concepts')
  @ApiOperation({ summary: '选股器 - 可用概念板块列表（供概念筛选器下拉选择）' })
  @ApiSuccessResponse(ScreenerConceptListDataDto)
  screenerConcepts() {
    return this.stockService.getScreenerConcepts()
  }

  @Post('screener/strategies/list')
  @ApiBearerAuth()
  @ApiOperation({ summary: '选股器 - 获取当前用户自定义策略列表' })
  @ApiSuccessResponse(ScreenerStrategyListDataDto)
  getScreenerStrategies(@CurrentUser() currentUser: TokenPayload) {
    return this.stockService.getStrategies(currentUser.id)
  }

  @Post('screener/strategies')
  @ApiBearerAuth()
  @ApiOperation({ summary: '选股器 - 创建自定义策略' })
  @ApiSuccessResponse(ScreenerStrategyDataDto)
  createScreenerStrategy(@CurrentUser() currentUser: TokenPayload, @Body() dto: CreateScreenerStrategyDto) {
    return this.stockService.createStrategy(currentUser.id, dto)
  }

  @Post('screener/strategies/update')
  @ApiBearerAuth()
  @ApiOperation({ summary: '选股器 - 更新自定义策略' })
  @ApiSuccessResponse(ScreenerStrategyDataDto)
  updateScreenerStrategy(
    @CurrentUser() currentUser: TokenPayload,
    @Body() dto: UpdateScreenerStrategyDto & { id: number },
  ) {
    return this.stockService.updateStrategy(currentUser.id, dto.id, dto)
  }

  @Post('screener/strategies/delete')
  @ApiBearerAuth()
  @ApiOperation({ summary: '选股器 - 删除自定义策略' })
  @ApiSuccessResponse(ScreenerStrategyDeleteDataDto)
  deleteScreenerStrategy(@CurrentUser() currentUser: TokenPayload, @Body() { id }: { id: number }) {
    return this.stockService.deleteStrategy(currentUser.id, id)
  }

  @Post('industries')
  @ApiOperation({ summary: '行业列表（含股票数量，按数量降序）' })
  @ApiSuccessResponse(IndustryListDataDto)
  getIndustries() {
    return this.stockService.getIndustries()
  }

  @Post('areas')
  @ApiOperation({ summary: '地域列表（含股票数量，按数量降序）' })
  @ApiSuccessResponse(AreaListDataDto)
  getAreas() {
    return this.stockService.getAreas()
  }
}
