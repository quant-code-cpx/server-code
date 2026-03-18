import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { TushareService } from './tushare.service'

/**
 * TushareSyncService
 *
 * 应用启动时检测本地数据库数据是否已是最新；
 * 若数据过期则触发增量同步（具体同步逻辑留待后续补充）。
 *
 * 扩展点：
 *  - checkStockBasicFreshness()  检查股票基础信息是否最新
 *  - checkDailyFreshness()       检查日线行情是否最新
 *  - checkMoneyFlowFreshness()   检查资金流向是否最新
 *  - …
 */
@Injectable()
export class TushareSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TushareSyncService.name)

  constructor(private readonly tushareService: TushareService) {}

  /** 应用启动后自动触发数据新鲜度检测 */
  async onApplicationBootstrap() {
    this.logger.log('开始检测数据库数据新鲜度...')
    await this.checkDataFreshness()
  }

  /**
   * 数据新鲜度检测入口
   * 后续在此处补充各个数据表的检测逻辑
   */
  async checkDataFreshness(): Promise<void> {
    // TODO: 检查各数据表最新记录日期，与交易日历对比，决定是否触发同步
    this.logger.log('数据新鲜度检测完成（具体检测逻辑待补充）')
  }
}
