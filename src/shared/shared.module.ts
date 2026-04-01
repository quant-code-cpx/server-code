import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { CacheService } from './cache.service'
import { PrismaService } from './prisma.service'
import { RedisProvider } from './redis.provider'
import { TokenService } from './token.service'
import { LoggerModule } from './logger/logger.module'

/**
 * SharedModule — 全局共享基础模块。
 *
 * 通过 @Global() 装饰器全局注册，应用中的任意模块可直接注入以下提供者，
 * 无需重复导入 SharedModule。
 *
 * 导出的服务：
 *   - PrismaService   Prisma ORM 客户端，急用于所有数据库操作
 *   - RedisProvider   Redis 客户端实例（通过 @Inject(REDIS_CLIENT) 注入）
 *   - TokenService    JWT Access Token / Refresh Token 的签发与校验
 *   - LoggerService   日志服务（开发环境 Console，生产环境 Winston 轮转正日志）
 *
 * 内部导入：
 *   - LoggerModule.forRoot()  动态创建全局 LoggerService
 *   - JwtModule.register()    为 JwtService 提供依赖（secret 由 TokenService 构造函数从 ConfigService 读取）
 */
@Global()
@Module({
  imports: [LoggerModule.forRoot(), JwtModule.register({ global: true, secret: '' })],
  providers: [PrismaService, RedisProvider, TokenService, CacheService],
  exports: [PrismaService, RedisProvider, TokenService, CacheService],
})
export class SharedModule {}
