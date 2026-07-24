import type { INestApplication, ModuleMetadata } from '@nestjs/common'

import { ValidationPipe } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import type { RedisClientType } from 'redis'

import configs from 'src/config'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { SharedModule } from 'src/shared/shared.module'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { REDIS_CLIENT } from 'src/shared/redis.provider'

export interface LegacyE2eApp {
  app: INestApplication
  prisma: PrismaService
  redis: RedisClientType
}

type LegacyE2eModuleOptions = Pick<ModuleMetadata, 'imports' | 'controllers' | 'providers'>

export async function createLegacyE2eApp(options: LegacyE2eModuleOptions): Promise<LegacyE2eApp> {
  if (!(BigInt.prototype as { toJSON?: () => number }).toJSON) {
    ;(BigInt.prototype as { toJSON?: () => number }).toJSON = function () {
      return Number(this)
    }
  }

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [...Object.values(configs)] }),
      SharedModule,
      ...(options.imports ?? []),
    ],
    controllers: options.controllers ?? [],
    providers: [...(options.providers ?? []), { provide: APP_GUARD, useClass: JwtAuthGuard }, RolesGuard],
  }).compile()

  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] })
  app.use(cookieParser())
  app.setGlobalPrefix('api')
  app.useGlobalInterceptors(new TransformInterceptor())
  app.useGlobalFilters(new GlobalExceptionsFilter(true, app.get(LoggerService)))
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
  await app.listen(0, '127.0.0.1')

  return {
    app,
    prisma: app.get(PrismaService),
    redis: app.get<RedisClientType>(REDIS_CLIENT),
  }
}
