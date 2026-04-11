import { forwardRef, Module } from '@nestjs/common'
import { BacktestModule } from 'src/apps/backtest/backtest.module'
import { PortfolioModule } from 'src/apps/portfolio/portfolio.module'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { SignalController } from './signal.controller'
import { SignalService } from './signal.service'
import { SignalGenerationService } from './signal-generation.service'
import { DriftDetectionService } from './drift-detection.service'

@Module({
  imports: [
    WebsocketModule,
    forwardRef(() => BacktestModule),
    forwardRef(() => PortfolioModule),
  ],
  controllers: [SignalController],
  providers: [SignalService, SignalGenerationService, DriftDetectionService],
  exports: [SignalGenerationService, DriftDetectionService, SignalService],
})
export class SignalModule {}
