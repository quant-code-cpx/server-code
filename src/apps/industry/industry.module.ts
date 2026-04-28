import { Module } from '@nestjs/common'
import { IndustryController } from './industry.controller'
import { IndustryDictService } from './industry-dict.service'

@Module({
  controllers: [IndustryController],
  providers: [IndustryDictService],
  exports: [IndustryDictService],
})
export class IndustryModule {}
