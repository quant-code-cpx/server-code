import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { BACKTESTING_QUEUE } from 'src/constant/queue.constant'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { BacktestController } from './backtest.controller'
import { BacktestRunService } from './services/backtest-run.service'
import { BacktestDataService } from './services/backtest-data.service'
import { BacktestDataReadinessService } from './services/backtest-data-readiness.service'
import { BacktestExecutionService } from './services/backtest-execution.service'
import { BacktestMetricsService } from './services/backtest-metrics.service'
import { BacktestReportService } from './services/backtest-report.service'
import { BacktestStrategyRegistryService } from './services/backtest-strategy-registry.service'
import { BacktestEngineService } from './services/backtest-engine.service'
import { BacktestWalkForwardService } from './services/backtest-walk-forward.service'
import { BacktestComparisonService } from './services/backtest-comparison.service'
import { BacktestMonteCarloService } from './services/backtest-monte-carlo.service'
import { BacktestAttributionService } from './services/backtest-attribution.service'
import { BacktestCostSensitivityService } from './services/backtest-cost-sensitivity.service'
import { BacktestParamSensitivityService } from './services/backtest-param-sensitivity.service'
import { BacktestToolFacade } from './backtest-tool.facade'
import { PointInTimeUniverseService } from './services/point-in-time-universe.service'
import { PointInTimeFinancialService } from './services/point-in-time-financial.service'
import { BacktestAnalyticsRepository } from './backtest-analytics.repository'
import { BacktestAnalyticsReadAdapter } from './backtest-analytics-read.adapter'
import { BacktestAnalyticsToolFacade } from './backtest-analytics-tool.facade'
import { BACKTEST_ANALYTICS_READ_PORT } from './ports/backtest-analytics-read.port'

@Module({
  imports: [BullModule.registerQueue({ name: BACKTESTING_QUEUE }), WebsocketModule],
  controllers: [BacktestController],
  providers: [
    BacktestRunService,
    BacktestDataService,
    BacktestDataReadinessService,
    BacktestExecutionService,
    BacktestMetricsService,
    BacktestReportService,
    BacktestStrategyRegistryService,
    BacktestEngineService,
    BacktestWalkForwardService,
    BacktestComparisonService,
    BacktestMonteCarloService,
    BacktestAttributionService,
    BacktestCostSensitivityService,
    BacktestParamSensitivityService,
    BacktestToolFacade,
    PointInTimeUniverseService,
    PointInTimeFinancialService,
    BacktestAnalyticsRepository,
    BacktestAnalyticsReadAdapter,
    { provide: BACKTEST_ANALYTICS_READ_PORT, useExisting: BacktestAnalyticsReadAdapter },
    BacktestAnalyticsToolFacade,
  ],
  exports: [
    BacktestRunService,
    BacktestEngineService,
    BacktestReportService,
    BacktestWalkForwardService,
    BacktestComparisonService,
    BacktestStrategyRegistryService,
    BacktestDataService,
    BacktestToolFacade,
    PointInTimeUniverseService,
    PointInTimeFinancialService,
    BacktestAnalyticsToolFacade,
  ],
})
export class BacktestModule {}
