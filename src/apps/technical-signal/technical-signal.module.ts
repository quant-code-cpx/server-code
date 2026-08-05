import { Module } from '@nestjs/common'
import { PrismaTechnicalSignalRepository } from './repositories/prisma-technical-signal.repository'
import { TechnicalSignalController } from './technical-signal.controller'
import { TechnicalSignalDefinitionService } from './services/technical-signal-definition.service'
import { TechnicalSignalStatisticsService } from './services/technical-signal-statistics.service'
import { TechnicalSignalEvaluationService } from './services/technical-signal-evaluation.service'
import { TechnicalSignalToolFacade } from './technical-signal-tool.facade'

@Module({
  controllers: [TechnicalSignalController],
  providers: [
    PrismaTechnicalSignalRepository,
    TechnicalSignalDefinitionService,
    TechnicalSignalEvaluationService,
    TechnicalSignalStatisticsService,
    TechnicalSignalToolFacade,
  ],
  exports: [
    TechnicalSignalDefinitionService,
    TechnicalSignalEvaluationService,
    TechnicalSignalStatisticsService,
    TechnicalSignalToolFacade,
  ],
})
export class TechnicalSignalModule {}
