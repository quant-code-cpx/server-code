import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'
import { HealthController } from './health.controller'
import { PrismaHealthIndicator } from './prisma.health'
import { RedisHealthIndicator } from './redis.health'

/**
 * HealthModule — 健康检查模块。
 *
 * 提供两个端点（不受 globalPrefix 影响，直接注册到根路径）：
 *   GET /health — 存活探针（Liveness），仅验证应用进程响应正常
 *   GET /ready  — 就绪探针（Readiness），验证 DB + Redis 连通性
 *
 * PrismaService 和 REDIS_CLIENT 已由 SharedModule 全局导出，无需重复导入。
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
