import { Module } from '@nestjs/common'
import { TushareModule } from 'src/tushare/tushare.module'
import { TushareAdminController } from './tushare-admin.controller'

@Module({
  imports: [TushareModule],
  controllers: [TushareAdminController],
})
export class TushareAdminModule {}
