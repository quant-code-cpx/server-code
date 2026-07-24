import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { HealthCheck, HealthCheckService } from '@nestjs/terminus'
import { Public } from 'src/common/decorators/public.decorator'
import { PrismaHealthIndicator } from './prisma.health'
import { ReadinessService } from './readiness.service'
import { RedisHealthIndicator } from './redis.health'

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly readinessState: ReadinessService,
  ) {}

  @Get('health')
  @Public()
  @ApiOperation({ summary: '存活探针（Liveness）' })
  @HealthCheck()
  liveness() {
    return this.health.check([])
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: '就绪探针（Readiness）' })
  @HealthCheck()
  readiness() {
    if (!this.readinessState.isAcceptingTraffic()) {
      throw new ServiceUnavailableException('服务正在摘流')
    }
    return this.health.check([() => this.prismaHealth.isHealthy('database'), () => this.redisHealth.isHealthy('redis')])
  }
}
