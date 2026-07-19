import { Module } from '@nestjs/common'
import { IndustryController } from './industry.controller'
import { IndustryDictService } from './industry-dict.service'
import { SectorToolFacade } from './sector-tool.facade'

@Module({
  controllers: [IndustryController],
  providers: [IndustryDictService, SectorToolFacade],
  exports: [IndustryDictService, SectorToolFacade],
})
export class IndustryModule {}
