import { Module } from '@nestjs/common'
import { StockController } from './stock.controller'
import { StockService } from './stock.service'
import { StockAnalysisService } from './stock-analysis.service'
import { StockListService } from './stock-list.service'
import { StockDetailService } from './stock-detail.service'
import { StockMoneyFlowService } from './stock-moneyflow.service'
import { StockFinancialService } from './stock-financial.service'
import { StockScreenerService } from './stock-screener.service'
import { TushareModule } from 'src/tushare/tushare.module'

@Module({
  imports: [TushareModule],
  controllers: [StockController],
  providers: [
    StockService,
    StockAnalysisService,
    StockListService,
    StockDetailService,
    StockMoneyFlowService,
    StockFinancialService,
    StockScreenerService,
  ],
  exports: [StockService],
})
export class StockModule {}
