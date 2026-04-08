import { Injectable } from '@nestjs/common'
import { StockListQueryDto } from './dto/stock-list-query.dto'
import { StockSearchDto } from './dto/stock-search.dto'
import { StockDetailChartDto } from './dto/stock-detail-chart.dto'
import { StockDetailMoneyFlowDto } from './dto/stock-detail-money-flow.dto'
import { StockDetailFinancialsDto } from './dto/stock-detail-financials.dto'
import { StockDetailShareholdersDto } from './dto/stock-detail-shareholders.dto'
import { StockDetailShareCapitalDto } from './dto/stock-detail-share-capital.dto'
import { StockDetailFinancingDto } from './dto/stock-detail-financing.dto'
import { StockDetailFinancialStatementsDto } from './dto/stock-detail-financial-statements.dto'
import { CreateScreenerStrategyDto, UpdateScreenerStrategyDto } from './dto/stock-screener-strategy.dto'
import { StockScreenerQueryDto } from './dto/stock-screener-query.dto'
import { StockListService } from './stock-list.service'
import { StockDetailService } from './stock-detail.service'
import { StockMoneyFlowService } from './stock-moneyflow.service'
import { StockFinancialService } from './stock-financial.service'
import { StockScreenerService } from './stock-screener.service'

/**
 * StockService — Facade
 *
 * 所有公共方法均委托给对应的子服务，保持对外接口不变。
 */
@Injectable()
export class StockService {
  constructor(
    private readonly stockListService: StockListService,
    private readonly stockDetailService: StockDetailService,
    private readonly stockMoneyFlowService: StockMoneyFlowService,
    private readonly stockFinancialService: StockFinancialService,
    private readonly stockScreenerService: StockScreenerService,
  ) {}

  // ─── 股票列表 ─────────────────────────────────────────────────────────────────

  findAll(query: StockListQueryDto) {
    return this.stockListService.findAll(query)
  }

  search(dto: StockSearchDto) {
    return this.stockListService.search(dto)
  }

  findOne(code: string) {
    return this.stockListService.findOne(code)
  }

  // ─── 股票详情 ─────────────────────────────────────────────────────────────────

  getDetailOverview(tsCode: string) {
    return this.stockDetailService.getDetailOverview(tsCode)
  }

  getDetailChart(dto: StockDetailChartDto) {
    return this.stockDetailService.getDetailChart(dto)
  }

  getStockConcepts(tsCode: string) {
    return this.stockDetailService.getStockConcepts(tsCode)
  }

  // ─── 资金流 ───────────────────────────────────────────────────────────────────

  getDetailTodayFlow(tsCode: string) {
    return this.stockMoneyFlowService.getDetailTodayFlow(tsCode)
  }

  getDetailMoneyFlow(dto: StockDetailMoneyFlowDto) {
    return this.stockMoneyFlowService.getDetailMoneyFlow(dto)
  }

  getDetailMainMoneyFlow(dto: StockDetailMoneyFlowDto) {
    return this.stockMoneyFlowService.getDetailMainMoneyFlow(dto)
  }

  // ─── 财务 ─────────────────────────────────────────────────────────────────────

  getDetailFinancials(dto: StockDetailFinancialsDto) {
    return this.stockFinancialService.getDetailFinancials(dto)
  }

  getDetailShareholders(dto: StockDetailShareholdersDto) {
    return this.stockFinancialService.getDetailShareholders(dto)
  }

  getDetailDividendFinancing(dto: StockDetailFinancingDto) {
    return this.stockFinancialService.getDetailDividendFinancing(dto)
  }

  getDetailShareCapital(dto: StockDetailShareCapitalDto) {
    return this.stockFinancialService.getDetailShareCapital(dto)
  }

  getDetailFinancialStatements(dto: StockDetailFinancialStatementsDto) {
    return this.stockFinancialService.getDetailFinancialStatements(dto)
  }

  getDetailFinancing(dto: StockDetailFinancingDto) {
    return this.stockFinancialService.getDetailFinancing(dto)
  }

  // ─── 选股器 ───────────────────────────────────────────────────────────────────

  screener(query: StockScreenerQueryDto) {
    return this.stockScreenerService.screener(query)
  }

  getIndustries() {
    return this.stockScreenerService.getIndustries()
  }

  getAreas() {
    return this.stockScreenerService.getAreas()
  }

  getScreenerPresets() {
    return this.stockScreenerService.getScreenerPresets()
  }

  getStrategies(userId: number) {
    return this.stockScreenerService.getStrategies(userId)
  }

  createStrategy(userId: number, dto: CreateScreenerStrategyDto) {
    return this.stockScreenerService.createStrategy(userId, dto)
  }

  updateStrategy(userId: number, id: number, dto: UpdateScreenerStrategyDto) {
    return this.stockScreenerService.updateStrategy(userId, id, dto)
  }

  deleteStrategy(userId: number, id: number) {
    return this.stockScreenerService.deleteStrategy(userId, id)
  }
}
