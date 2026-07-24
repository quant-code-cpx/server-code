import { buildShutdownConfig } from '../shutdown.config'

describe('ShutdownConfig', () => {
  it('[BIZ] 未配置宽限期时使用 5 秒默认值', () => {
    expect(buildShutdownConfig({})).toEqual({ graceMs: 5_000 })
  })

  it('[BIZ] 接受 0-120000ms 的整数宽限期', () => {
    expect(buildShutdownConfig({ SHUTDOWN_GRACE_MS: '0' })).toEqual({ graceMs: 0 })
    expect(buildShutdownConfig({ SHUTDOWN_GRACE_MS: '120000' })).toEqual({ graceMs: 120_000 })
  })

  it.each(['-1', '120001', '500.5', 'text'])('[ERR] 拒绝非法宽限期：%s', (value) => {
    expect(() => buildShutdownConfig({ SHUTDOWN_GRACE_MS: value })).toThrow('SHUTDOWN_GRACE_MS')
  })
})
