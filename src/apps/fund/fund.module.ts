import { Module } from '@nestjs/common'
import { FundController } from './fund.controller'
import { FundService } from './fund.service'

@Module({
  controllers: [FundController],
  providers: [FundService],
})
export class FundModule {}
