import { Module } from '@nestjs/common'
import { PortfolioController } from './portfolio.controller'
import { PortfolioService } from './portfolio.service'
import { PortfolioRiskService } from './portfolio-risk.service'
import { RiskCheckService } from './risk-check.service'

@Module({
  controllers: [PortfolioController],
  providers: [PortfolioService, PortfolioRiskService, RiskCheckService],
})
export class PortfolioModule {}
