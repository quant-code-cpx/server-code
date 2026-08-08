import { AppConfig, IAppConfig } from './app.config'
import { TokenConfig, ITokenConfig } from './token.config'
import { RedisConfig, IRedisConfig } from './redis.config'
import { TushareConfig, ITushareConfig } from './tushare.config'
import { ModelConfig, IModelConfig } from './model.config'
import { AgentExecutionConfig, IAgentExecutionConfig } from './agent-execution.config'
import { AgentToolsConfig, IAgentToolsConfig } from './agent-tools.config'
import { WebSearchConfig, IWebSearchConfig } from './web-search.config'
import { AgentQueueConfig, IAgentQueueConfig } from './agent-queue.config'
import { ProcessRoleConfig, IProcessRoleConfig } from './process-role.config'
import { AgentApiConfig, IAgentApiConfig } from './agent-api.config'
import { AgentStreamConfig, IAgentStreamConfig } from './agent-stream.config'
import { AgentContextConfig, IAgentContextConfig } from './agent-context.config'
import { AgentSchedulerConfig, IAgentSchedulerConfig } from './agent-scheduler.config'
import { AgentNotificationConfig, IAgentNotificationConfig } from './agent-notification.config'
import { AgentReportConfig, IAgentReportConfig } from './agent-report.config'
import { AgentObservabilityConfig, IAgentObservabilityConfig } from './agent-observability.config'
import { CronLockConfig, ICronLockConfig } from './cron-lock.config'
import { ShutdownConfig, IShutdownConfig } from './shutdown.config'
import { AgentRetrievalConfig, IAgentRetrievalConfig } from './agent-retrieval.config'
import { NewsConfig, INewsConfig } from './news.config'

export * from './app.config'
export * from './token.config'
export * from './redis.config'
export * from './tushare.config'
export * from './model.config'
export * from './agent-execution.config'
export * from './agent-tools.config'
export * from './web-search.config'
export * from './agent-queue.config'
export * from './process-role.config'
export * from './agent-api.config'
export * from './agent-stream.config'
export * from './agent-context.config'
export * from './agent-scheduler.config'
export * from './agent-notification.config'
export * from './agent-report.config'
export * from './agent-observability.config'
export * from './cron-lock.config'
export * from './shutdown.config'
export * from './agent-retrieval.config'
export * from './news.config'

export type AllConfigType = {
  app: IAppConfig
  token: ITokenConfig
  redis: IRedisConfig
  tushare: ITushareConfig
  agentModel: IModelConfig
  agentExecution: IAgentExecutionConfig
  agentTools: IAgentToolsConfig
  webSearch: IWebSearchConfig
  agentQueue: IAgentQueueConfig
  processRole: IProcessRoleConfig
  agentApi: IAgentApiConfig
  agentStream: IAgentStreamConfig
  agentContext: IAgentContextConfig
  agentScheduler: IAgentSchedulerConfig
  agentNotification: IAgentNotificationConfig
  agentReport: IAgentReportConfig
  agentObservability: IAgentObservabilityConfig
  cronLock: ICronLockConfig
  shutdown: IShutdownConfig
  agentRetrieval: IAgentRetrievalConfig
  news: INewsConfig
}

const configs = {
  AppConfig,
  TokenConfig,
  RedisConfig,
  TushareConfig,
  ModelConfig,
  AgentExecutionConfig,
  AgentToolsConfig,
  WebSearchConfig,
  AgentQueueConfig,
  ProcessRoleConfig,
  AgentApiConfig,
  AgentStreamConfig,
  AgentContextConfig,
  AgentSchedulerConfig,
  AgentNotificationConfig,
  AgentReportConfig,
  AgentObservabilityConfig,
  CronLockConfig,
  ShutdownConfig,
  AgentRetrievalConfig,
  NewsConfig,
}

export default configs
