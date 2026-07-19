import { buildAgentQueueConfig } from 'src/config/agent-queue.config'
import { assertProcessEntrypoint, buildProcessRoleConfig } from 'src/config/process-role.config'
import { AgentProcessor } from '../agent.processor'
import { buildAgentRedisConnection, AgentQueueModule } from '../agent-queue.module'
import { AgentReconcilerService } from '../agent-reconciler.service'

describe('Agent process role gate', () => {
  it('开发默认 all，生产默认 api；显式 worker 只启用 worker', () => {
    expect(buildProcessRoleConfig({ NODE_ENV: 'development' })).toMatchObject({
      role: 'all',
      apiEnabled: true,
      agentWorkerEnabled: true,
    })
    expect(buildProcessRoleConfig({ NODE_ENV: 'production' })).toMatchObject({
      role: 'api',
      apiEnabled: true,
      agentWorkerEnabled: false,
    })
    expect(buildProcessRoleConfig({ PROCESS_ROLE: 'agent-worker' })).toMatchObject({
      apiEnabled: false,
      agentWorkerEnabled: true,
    })
  })

  it('拒绝非法 role 和错误入口', () => {
    expect(() => buildProcessRoleConfig({ PROCESS_ROLE: 'worker' })).toThrow('PROCESS_ROLE')
    expect(() => assertProcessEntrypoint('api', 'agent-worker')).toThrow('api 入口')
    expect(() => assertProcessEntrypoint('agent-worker', 'api')).toThrow('agent-worker 入口')
    expect(() => assertProcessEntrypoint('api', 'all')).not.toThrow()
  })

  it('API role 不注册 Processor/Reconciler，worker role 注册', () => {
    const apiProviders = AgentQueueModule.register({ workerEnabled: false }).providers
    const workerProviders = AgentQueueModule.register({ workerEnabled: true }).providers
    expect(apiProviders).not.toContain(AgentProcessor)
    expect(apiProviders).not.toContain(AgentReconcilerService)
    expect(workerProviders).toContain(AgentProcessor)
    expect(workerProviders).toContain(AgentReconcilerService)
  })

  it('独立 Redis URL 支持 ACL、DB、TLS；空值回退共享 Redis', () => {
    const shared = buildAgentRedisConnection(buildAgentQueueConfig({}), {
      host: 'redis',
      port: 6379,
      url: 'redis://redis:6379',
    })
    expect(shared).toMatchObject({ host: 'redis', port: 6379, maxRetriesPerRequest: null })

    const dedicated = buildAgentRedisConnection(
      buildAgentQueueConfig({ AGENT_QUEUE_REDIS_URL: 'rediss://agent:secret@queue.example:6380/2' }),
      { host: 'redis', port: 6379, url: 'redis://redis:6379' },
    )
    expect(dedicated).toMatchObject({
      host: 'queue.example',
      port: 6380,
      username: 'agent',
      password: 'secret',
      db: 2,
      tls: {},
      maxRetriesPerRequest: null,
    })
  })
})
