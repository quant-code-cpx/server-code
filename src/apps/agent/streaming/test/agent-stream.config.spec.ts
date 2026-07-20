import { buildAgentStreamConfig } from 'src/config/agent-stream.config'

describe('Agent stream config', () => {
  it('提供受限默认值', () => {
    expect(buildAgentStreamConfig({})).toEqual({
      heartbeatMs: 15_000,
      idleTimeoutMs: 300_000,
      maxConnectionsPerUser: 3,
      maxBufferBytes: 1_048_576,
      pollIntervalMs: 250,
    })
  })

  it('拒绝 idle timeout 不大于 heartbeat', () => {
    expect(() =>
      buildAgentStreamConfig({ AGENT_SSE_HEARTBEAT_MS: '10000', AGENT_SSE_IDLE_TIMEOUT_MS: '10000' }),
    ).toThrow('必须大于')
  })

  it.each([
    ['AGENT_SSE_HEARTBEAT_MS', '999'],
    ['AGENT_SSE_MAX_CONNECTIONS_PER_USER', '0'],
    ['AGENT_SSE_MAX_BUFFER_BYTES', '1024'],
  ])('拒绝越界配置 %s=%s', (name, value) => {
    expect(() => buildAgentStreamConfig({ [name]: value })).toThrow(name)
  })
})
