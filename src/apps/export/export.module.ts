import { Module } from '@nestjs/common'
import { ExportController } from './export.controller'
import { ExportService } from './export.service'
import { StockModule } from 'src/apps/stock/stock.module'
import { FactorModule } from 'src/apps/factor/factor.module'

@Module({
  imports: [StockModule, FactorModule],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
