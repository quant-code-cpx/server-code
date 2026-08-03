import { Module } from '@nestjs/common'
import { PrismaTechnicalSignalRepository } from './repositories/prisma-technical-signal.repository'
import { TechnicalSignalController } from './technical-signal.controller'
import { TechnicalSignalDefinitionService } from './services/technical-signal-definition.service'
import { TechnicalSignalStatisticsService } from './services/technical-signal-statistics.service'

@Module({
  controllers: [TechnicalSignalController],
  providers: [PrismaTechnicalSignalRepository, TechnicalSignalDefinitionService, TechnicalSignalStatisticsService],
  exports: [TechnicalSignalDefinitionService, TechnicalSignalStatisticsService],
})
export class TechnicalSignalModule {}
