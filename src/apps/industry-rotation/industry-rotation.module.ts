import { Module } from '@nestjs/common'
import { IndustryRotationController } from './industry-rotation.controller'
import { IndustryRotationService } from './industry-rotation.service'

@Module({
  controllers: [IndustryRotationController],
  providers: [IndustryRotationService],
})
export class IndustryRotationModule {}
