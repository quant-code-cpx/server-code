import { Module } from '@nestjs/common'
import { MacroResearchRepository } from './macro-research.repository'
import { MacroResearchToolFacade } from './macro-research-tool.facade'

@Module({
  providers: [MacroResearchRepository, MacroResearchToolFacade],
  exports: [MacroResearchToolFacade],
})
export class MacroResearchModule {}
