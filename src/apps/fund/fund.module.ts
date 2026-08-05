import { Module } from '@nestjs/common'
import { FundController } from './fund.controller'
import { FundService } from './fund.service'
import { FundResearchRepository } from './fund-research.repository'
import { FundResearchToolFacade } from './fund-research-tool.facade'

@Module({
  controllers: [FundController],
  providers: [FundService, FundResearchRepository, FundResearchToolFacade],
  exports: [FundResearchToolFacade],
})
export class FundModule {}
