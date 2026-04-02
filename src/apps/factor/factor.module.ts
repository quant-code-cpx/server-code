import { Module } from '@nestjs/common'
import { FactorController } from './factor.controller'
import { FactorService } from './factor.service'
import { FactorLibraryService } from './services/factor-library.service'
import { FactorComputeService } from './services/factor-compute.service'
import { FactorAnalysisService } from './services/factor-analysis.service'
import { FactorScreeningService } from './services/factor-screening.service'
import { FactorPrecomputeService } from './services/factor-precompute.service'
import { FactorExpressionService } from './services/factor-expression.service'
import { FactorCustomService } from './services/factor-custom.service'
import { FactorBacktestService } from './services/factor-backtest.service'
import { FactorOrthogonalService } from './services/factor-orthogonal.service'
import { BacktestModule } from '../backtest/backtest.module'

@Module({
  imports: [BacktestModule],
  controllers: [FactorController],
  providers: [
    FactorService,
    FactorLibraryService,
    FactorExpressionService,
    FactorComputeService,
    FactorAnalysisService,
    FactorScreeningService,
    FactorPrecomputeService,
    FactorCustomService,
    FactorBacktestService,
    FactorOrthogonalService,
  ],
})
export class FactorModule {}
