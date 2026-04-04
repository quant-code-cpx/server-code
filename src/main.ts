import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { ConfigService } from '@nestjs/config'
import { ValidationPipe } from '@nestjs/common'
import helmet from 'helmet'
import { json, urlencoded } from 'express'
const cookieParser = require('cookie-parser')
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { IAppConfig, APP_CONFIG_TOKEN } from './config/app.config'
import { LoggerService } from './shared/logger/logger.service'
import { TransformInterceptor } from './lifecycle/interceptors/transform.interceptor'
import { LoggingInterceptor } from './lifecycle/interceptors/logging.interceptor'
import { GlobalExceptionsFilter } from './lifecycle/filters/global.exception'
import { REFRESH_TOKEN_COOKIE } from './constant/auth.constant'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })

  const configService = app.get(ConfigService)
  const loggerService = app.get(LoggerService)
  const { port, isDev, globalPrefix, logHttpRequests, logHttpBody } = configService.get<IAppConfig>(APP_CONFIG_TOKEN, { infer: true })

  // ── 请求体大小限制（防止超大 JSON 攻击，最大 1 MB） ──
  app.use(json({ limit: '1mb' }))
  app.use(urlencoded({ limit: '1mb', extended: true }))

  // ── 安全头 ──
  app.use(helmet())

  // ── CORS ──
  // credentials:true 不能与 origin:'*' 同时使用（浏览器会拦截）
  // 生产环境通过 CORS_ORIGIN 环境变量配置域名白名单（多个域名用逗号分隔）
  if (isDev) {
    app.enableCors({ origin: true, credentials: true })
  } else {
    const corsOriginEnv = process.env.CORS_ORIGIN
    if (!corsOriginEnv) {
      loggerService.warn('CORS_ORIGIN 未配置，生产环境 CORS 已禁用（所有跨域请求将被浏览器拦截）', 'Bootstrap')
      app.enableCors({ origin: false, credentials: true })
    } else {
      const origins = corsOriginEnv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const origin = origins.length === 1 ? origins[0] : origins
      app.enableCors({ origin, credentials: true })
      loggerService.log(`CORS 白名单：${origins.join(', ')}`, 'Bootstrap')
    }
  }

  // ── Cookie 解析（用于读取 HttpOnly Refresh Token Cookie） ──
  app.use(cookieParser())

  // ── 前缀 ──
  app.setGlobalPrefix(globalPrefix)

  // ── 日志 ──
  app.useLogger(loggerService)

  // ── 拦截器 ──
  app.useGlobalInterceptors(new TransformInterceptor())
  if (logHttpRequests) {
    app.useGlobalInterceptors(new LoggingInterceptor(loggerService, logHttpBody))
  }

  // ── 异常过滤器 ──
  app.useGlobalFilters(new GlobalExceptionsFilter(isDev, loggerService))

  // ── 参数校验 ──
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      disableErrorMessages: !isDev,
    }),
  )

  // ── Swagger（开发环境） ──
  if (isDev) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Quant Server API')
      .setDescription('量化交易后端接口文档')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth(REFRESH_TOKEN_COOKIE)
      .build()
    const document = SwaggerModule.createDocument(app, swaggerConfig)
    SwaggerModule.setup('docs', app, document)
    loggerService.log(`Swagger docs: http://localhost:${port}/docs`, 'Bootstrap')
  }

  await app.listen(port, '0.0.0.0')
  loggerService.log(`Server running on http://localhost:${port}/${globalPrefix}`, 'Bootstrap')
}

bootstrap()
