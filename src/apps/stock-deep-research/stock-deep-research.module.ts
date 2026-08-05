import { Module } from '@nestjs/common'
import { StockChipRepository } from './chip/stock-chip.repository'
import { StockChipToolFacade } from './chip/stock-chip-tool.facade'
import { StockEventRepository } from './events/stock-event.repository'
import { StockEventToolFacade } from './events/stock-event-tool.facade'
import { StockMarginRepository } from './margin/stock-margin.repository'
import { StockMarginToolFacade } from './margin/stock-margin-tool.facade'
import { RelativeStrengthCalculationService } from './relative-strength/relative-strength-calculation.service'
import { RelativeStrengthRepository } from './relative-strength/relative-strength.repository'
import { RelativeStrengthToolFacade } from './relative-strength/relative-strength-tool.facade'
import { StockShareholderRepository } from './shareholders/stock-shareholder.repository'
import { StockShareholderToolFacade } from './shareholders/stock-shareholder-tool.facade'

@Module({
  providers: [
    StockChipRepository,
    StockChipToolFacade,
    StockMarginRepository,
    StockMarginToolFacade,
    RelativeStrengthRepository,
    RelativeStrengthCalculationService,
    RelativeStrengthToolFacade,
    StockEventRepository,
    StockEventToolFacade,
    StockShareholderRepository,
    StockShareholderToolFacade,
  ],
  exports: [
    StockChipToolFacade,
    StockMarginToolFacade,
    RelativeStrengthToolFacade,
    StockEventToolFacade,
    StockShareholderToolFacade,
  ],
})
export class StockDeepResearchModule {}
