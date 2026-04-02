import { Module } from '@nestjs/common'
import { StrategyDraftController } from './strategy-draft.controller'
import { StrategyDraftService } from './strategy-draft.service'
import { BacktestModule } from 'src/apps/backtest/backtest.module'

@Module({
  imports: [BacktestModule],
  controllers: [StrategyDraftController],
  providers: [StrategyDraftService],
})
export class StrategyDraftModule {}
