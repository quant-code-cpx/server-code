import { Module } from '@nestjs/common'
import { IndexController } from './index.controller'
import { IndexService } from './index.service'
import { IndexResearchRepository } from './index-research.repository'
import { IndexResearchToolFacade } from './index-research-tool.facade'

@Module({
  controllers: [IndexController],
  providers: [IndexService, IndexResearchRepository, IndexResearchToolFacade],
  exports: [IndexResearchToolFacade],
})
export class IndexModule {}
