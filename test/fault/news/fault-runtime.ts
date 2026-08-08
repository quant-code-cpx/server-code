import { BullModule } from '@nestjs/bullmq'
import { Controller, Get, Module, ValidationPipe } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { AuthModule } from 'src/apps/auth/auth.module'
import { NewsModule } from 'src/apps/news/news.module'
import { Public } from 'src/common/decorators/public.decorator'
import configs from 'src/config'
import { IRedisConfig, REDIS_CONFIG_TOKEN } from 'src/config/redis.config'
import { assertProcessEntrypoint } from 'src/config/process-role.config'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { SharedModule } from 'src/shared/shared.module'

@Controller('health')
class FaultHealthController {
  @Get()
  @Public()
  health() {
    return { status: 'ok' }
  }
}

const infrastructureImports = [
  ConfigModule.forRoot({ envFilePath: ['.env'], isGlobal: true, load: [...Object.values(configs)] }),
  SharedModule,
  BullModule.forRootAsync({
    useFactory: (configService: ConfigService) => {
      const redis = configService.get<IRedisConfig>(REDIS_CONFIG_TOKEN)
      if (!redis) throw new Error('[Redis] 配置缺失')
      return {
        connection: {
          host: redis.host,
          port: redis.port,
          username: process.env.REDIS_USERNAME || undefined,
          password: process.env.REDIS_PASSWORD || undefined,
        },
      }
    },
    inject: [ConfigService],
  }),
  NewsModule,
]

@Module({
  imports: [
    ...infrastructureImports,
    AuthModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 10_000, limit: 1_000_000 }]),
  ],
  controllers: [FaultHealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
class FaultApiModule {}

@Module({ imports: infrastructureImports })
class FaultWorkerModule {}

async function bootstrapApi(): Promise<void> {
  assertProcessEntrypoint('api', process.env.PROCESS_ROLE as 'api')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(BigInt.prototype as any).toJSON = function () {
    return Number(this)
  }
  const app = await NestFactory.create<NestExpressApplication>(FaultApiModule)
  app.setGlobalPrefix('api', { exclude: ['/health'] })
  app.useGlobalInterceptors(new TransformInterceptor())
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
  app.enableShutdownHooks()
  await app.listen(3000, '0.0.0.0')
}

async function bootstrapWorker(): Promise<void> {
  assertProcessEntrypoint('worker', process.env.PROCESS_ROLE as 'worker')
  const app = await NestFactory.createApplicationContext(FaultWorkerModule)
  app.enableShutdownHooks()
}

async function main(): Promise<void> {
  const entrypoint = process.argv[2]
  if (entrypoint === 'api') return bootstrapApi()
  if (entrypoint === 'worker') return bootstrapWorker()
  throw new Error('fault runtime 只允许 api 或 worker')
}

void main()
