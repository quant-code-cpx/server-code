import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { AgentWorkerModule } from './agent-worker.module'
import {
  PROCESS_ROLE_CONFIG_TOKEN,
  assertProcessEntrypoint,
  type IProcessRoleConfig,
} from './config/process-role.config'
import { LoggerService } from './shared/logger/logger.service'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AgentWorkerModule, { bufferLogs: true })
  const configService = app.get(ConfigService)
  const role = configService.get<IProcessRoleConfig>(PROCESS_ROLE_CONFIG_TOKEN)
  if (!role) throw new Error('[ProcessRole] 配置缺失')
  assertProcessEntrypoint('agent-worker', role.role)

  const logger = app.get(LoggerService)
  app.useLogger(logger)
  app.enableShutdownHooks()
  logger.log({ operation: 'agentWorker.bootstrap', processRole: role.role }, 'Bootstrap')
}

void bootstrap()
