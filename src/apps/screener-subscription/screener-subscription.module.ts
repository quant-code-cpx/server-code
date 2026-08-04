import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { SCREENER_SUBSCRIPTION_QUEUE } from 'src/constant/queue.constant'
import { StockModule } from 'src/apps/stock/stock.module'
import { TechnicalSignalModule } from 'src/apps/technical-signal/technical-signal.module'
import { WebsocketModule } from 'src/websocket/websocket.module'
import { ScreenerSubscriptionController } from './screener-subscription.controller'
import { ScreenerSubscriptionService } from './screener-subscription.service'
import { ScreenerSubscriptionProcessor } from './screener-subscription.processor'
import { ScreenerSubscriptionScheduler } from './screener-subscription.scheduler'
import { buildProcessRoleConfig } from 'src/config/process-role.config'
import { RuleFingerprintService, RuleNormalizerService, RuleSpecValidatorService, TriggerPlannerService } from './rule'
import { SubscriptionDataReadinessService } from './subscription-data-readiness.service'
import { MetricCatalogService } from './metric-catalog'
import {
  FactorScreeningEvaluator,
  SignalEventEvaluator,
  StockScreeningEvaluator,
  SubscriptionEvaluatorRegistry,
} from './evaluator'
import { TechnicalSignalSnapshotScheduler } from './technical-signal-snapshot.scheduler'
import { TechnicalSignalSnapshotService } from './technical-signal-snapshot.service'

const processRole = buildProcessRoleConfig(process.env)

@Module({
  imports: [
    BullModule.registerQueue({ name: SCREENER_SUBSCRIPTION_QUEUE }),
    StockModule,
    TechnicalSignalModule,
    WebsocketModule,
  ],
  controllers: [ScreenerSubscriptionController],
  providers: [
    ScreenerSubscriptionService,
    ScreenerSubscriptionScheduler,
    RuleSpecValidatorService,
    RuleNormalizerService,
    RuleFingerprintService,
    TriggerPlannerService,
    SubscriptionDataReadinessService,
    MetricCatalogService,
    TechnicalSignalSnapshotService,
    TechnicalSignalSnapshotScheduler,
    StockScreeningEvaluator,
    FactorScreeningEvaluator,
    SignalEventEvaluator,
    SubscriptionEvaluatorRegistry,
    ...(processRole.queueWorkerEnabled ? [ScreenerSubscriptionProcessor] : []),
  ],
})
export class ScreenerSubscriptionModule {}
