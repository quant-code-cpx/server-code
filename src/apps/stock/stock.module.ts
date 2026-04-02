import { Module } from '@nestjs/common'
import { StockController } from './stock.controller'
import { StockService } from './stock.service'
import { StockAnalysisService } from './stock-analysis.service'
import { TushareModule } from 'src/tushare/tushare.module'

@Module({
  imports: [TushareModule],
  controllers: [StockController],
  providers: [StockService, StockAnalysisService],
  exports: [StockService],
})
export class StockModule {}
