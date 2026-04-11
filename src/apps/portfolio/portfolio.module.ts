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
  ],
  exports: [PortfolioService],
})
export class PortfolioModule {}
