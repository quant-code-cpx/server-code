import { Module } from '@nestjs/common'

import { ReportController } from './report.controller'
import { ReportService } from './report.service'
import { ReportDataCollectorService } from './services/report-data-collector.service'
import { ReportRendererService } from './services/report-renderer.service'

@Module({
  controllers: [ReportController],
  providers: [ReportService, ReportDataCollectorService, ReportRendererService],
  exports: [ReportService],
})
export class ReportModule {}
