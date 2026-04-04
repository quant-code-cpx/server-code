import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import configs from './config'
import { SharedModule } from './shared/shared.module'
import { RequestContextModule } from './shared/context/request-context.module'
import { HealthModule } from './shared/health/health.module'
import { AuthModule } from './apps/auth/auth.module'
import { UserModule } from './apps/user/user.module'
import { StockModule } from './apps/stock/stock.module'
import { MarketModule } from './apps/market/market.module'
import { HeatmapModule } from './apps/heatmap/heatmap.module'
import { TushareAdminModule } from './apps/tushare/tushare-admin.module'
import { FactorModule } from './apps/factor/factor.module'
import { QueueModule } from './queue/queue.module'
import { WebsocketModule } from './websocket/websocket.module'
import { JwtAuthGuard } from './lifecycle/guard/jwt-auth.guard'
import { TushareModule } from './tushare/tushare.module'
import { BacktestModule } from './apps/backtest/backtest.module'
import { WatchlistModule } from './apps/watchlist/watchlist.module'
import { ResearchNoteModule } from './apps/research-note/research-note.module'
import { ScreenerSubscriptionModule } from './apps/screener-subscription/screener-subscription.module'
import { StrategyDraftModule } from './apps/strategy-draft/strategy-draft.module'
import { IndexModule } from './apps/index/index.module'
import { StrategyModule } from './apps/strategy/strategy.module'
import { IndustryRotationModule } from './apps/industry-rotation/industry-rotation.module'

@Module({
  imports: [
    // ── 环境配置（全局） ──
    ConfigModule.forRoot({
      envFilePath: ['.env'],
      isGlobal: true,
      load: [...Object.values(configs)],
    }),

    // ── 限流（全局） ──
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        errorMessage: '操作过于频繁，请稍后再试！',
        throttlers: [{ name: 'default', ttl: seconds(10), limit: 20 }],
      }),
    }),

    // ── 核心共享模块（Prisma、Redis、Logger、Token） ──
    SharedModule,

    // ── 请求上下文（traceId 传播，必须在功能模块之前） ──
    RequestContextModule,

    // ── 健康检查（Liveness / Readiness 探针） ──
    HealthModule,

    // ── 定时任务（Tushare 盘后同步等） ──
    ScheduleModule.forRoot(),

    // ── Tushare 数据模块（API 封装 + 启动时数据新鲜度检测） ──
    TushareModule,

    // ── 功能模块 ──
    AuthModule,
    UserModule,
    StockModule,
    MarketModule,
    IndexModule,
    HeatmapModule,
    TushareAdminModule,
    FactorModule,
    BacktestModule,
    WatchlistModule,
    ResearchNoteModule,
    ScreenerSubscriptionModule,
    StrategyDraftModule,
    StrategyModule,
    IndustryRotationModule,

    // ── 队列模块（BullMQ 回测任务） ──
    QueueModule,

    // ── WebSocket 实时推送 ──
    WebsocketModule,
  ],
  controllers: [],
  providers: [
    // 全局守卫：JWT 鉴权 → 限流
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
