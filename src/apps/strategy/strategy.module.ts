import { Module } from '@nestjs/common'
import { BacktestModule } from 'src/apps/backtest/backtest.module'
import { StrategyController } from './strategy.controller'
import { StrategyService } from './strategy.service'
import { StrategySchemaValidatorService } from './strategy-schema-validator.service'

@Module({
  imports: [BacktestModule],
  controllers: [StrategyController],
  providers: [StrategyService, StrategySchemaValidatorService],
  exports: [StrategySchemaValidatorService],
})
export class StrategyModule {}
