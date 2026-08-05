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
import { FactorOptimizationService } from './services/factor-optimization.service'
import { BacktestModule } from '../backtest/backtest.module'
import { buildProcessRoleConfig } from 'src/config/process-role.config'
import { NoopScheduleModule } from 'src/shared/scheduler/noop-schedule.module'
import { FactorAnalysisToolFacade } from './factor-analysis-tool.facade'

const processRole = buildProcessRoleConfig(process.env)

@Module({
  imports: [
    // FactorPrecomputeService injects SchedulerRegistry. Only scheduler loads
    // the real ScheduleModule; API and workers receive a local no-op token.
    ...(processRole.schedulerEnabled ? [] : [NoopScheduleModule]),
    BacktestModule,
  ],
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
    FactorOptimizationService,
    FactorAnalysisToolFacade,
  ],
  exports: [FactorScreeningService, FactorAnalysisToolFacade],
})
export class FactorModule {}
