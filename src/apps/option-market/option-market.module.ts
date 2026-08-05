import { Module } from '@nestjs/common'
import { OptionMarketRepository } from './option-market.repository'
import { OptionMarketToolFacade } from './option-market-tool.facade'

@Module({
  providers: [OptionMarketRepository, OptionMarketToolFacade],
  exports: [OptionMarketToolFacade],
})
export class OptionMarketModule {}
