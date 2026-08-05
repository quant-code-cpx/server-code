import { forwardRef, Module } from '@nestjs/common'
import { PortfolioController } from './portfolio.controller'
import { PortfolioService } from './portfolio.service'
import { PortfolioRiskService } from './portfolio-risk.service'
import { RiskCheckService } from './risk-check.service'
import { BacktestPortfolioBridgeService } from './services/backtest-portfolio-bridge.service'
import { RebalancePlanService } from './services/rebalance-plan.service'
import { PortfolioPerformanceService } from './services/portfolio-performance.service'
import { PortfolioTradeLogService } from './services/portfolio-trade-log.service'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { SignalModule } from 'src/apps/signal/signal.module'
import { PortfolioToolFacade } from './portfolio-tool.facade'
import { PortfolioAnalyticsRepository } from './portfolio-analytics.repository'
import { PortfolioAnalyticsToolFacade } from './portfolio-analytics-tool.facade'
import { PortfolioSnapshotScheduler } from './portfolio-snapshot.scheduler'
import { PortfolioSnapshotService } from './portfolio-snapshot.service'

@Module({
  imports: [WebsocketModule, forwardRef(() => SignalModule)],
  controllers: [PortfolioController],
  providers: [
    PortfolioService,
    PortfolioRiskService,
    RiskCheckService,
    BacktestPortfolioBridgeService,
    RebalancePlanService,
    PortfolioPerformanceService,
    PortfolioTradeLogService,
    PortfolioToolFacade,
    PortfolioAnalyticsRepository,
    PortfolioAnalyticsToolFacade,
    PortfolioSnapshotService,
    PortfolioSnapshotScheduler,
  ],
  exports: [PortfolioService, PortfolioToolFacade, PortfolioAnalyticsToolFacade, PortfolioSnapshotService],
})
export class PortfolioModule {}
