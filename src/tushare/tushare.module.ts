import { Module } from '@nestjs/common'
import { TushareService } from './tushare.service'
import { TushareSyncService } from './tushare-sync.service'

/**
 * TushareModule
 *
 * 导出 TushareService，供其他功能模块（股票、市场、热力图等）注入使用。
 * TushareSyncService 在应用启动时自动执行数据新鲜度检测。
 */
@Module({
  providers: [TushareService, TushareSyncService],
  exports: [TushareService],
})
export class TushareModule {}
