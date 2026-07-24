import { Global, Module } from '@nestjs/common'
import { LoggerService } from 'src/shared/logger/logger.service'
import { CacheService } from 'src/shared/cache.service'
import { PrismaService } from 'src/shared/prisma.service'
import { REDIS_CLIENT } from 'src/shared/redis.provider'

export const AGENT_TEST_LOGGER = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  verbose: () => undefined,
  devLog: () => undefined,
} as unknown as LoggerService

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: LoggerService, useValue: AGENT_TEST_LOGGER },
    { provide: REDIS_CLIENT, useValue: { sendCommand: async () => '' } },
    { provide: CacheService, useValue: { getNamespaceMetrics: async () => [] } },
  ],
  exports: [PrismaService, LoggerService, REDIS_CLIENT, CacheService],
})
export class AgentTestInfrastructureModule {}
