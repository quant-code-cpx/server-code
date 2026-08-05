import { Module } from '@nestjs/common'
import { IndustryRotationController } from './industry-rotation.controller'
import { IndustryRotationService } from './industry-rotation.service'
import { IndustryRotationResearchRepository } from './industry-rotation-research.repository'
import { IndustryRotationToolFacade } from './industry-rotation-tool.facade'

@Module({
  controllers: [IndustryRotationController],
  providers: [IndustryRotationService, IndustryRotationResearchRepository, IndustryRotationToolFacade],
  exports: [IndustryRotationToolFacade],
})
export class IndustryRotationModule {}
