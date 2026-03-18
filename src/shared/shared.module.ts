import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PrismaService } from './prisma.service'
import { RedisProvider } from './redis.provider'
import { TokenService } from './token.service'
import { LoggerModule } from './logger/logger.module'

@Global()
@Module({
  imports: [LoggerModule.forRoot(), JwtModule.register({ global: true, secret: '' })],
  providers: [PrismaService, RedisProvider, TokenService],
  exports: [PrismaService, RedisProvider, TokenService],
})
export class SharedModule {}
