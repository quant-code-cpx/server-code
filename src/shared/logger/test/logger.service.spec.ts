import { resolveLogOutput, usesFileLogTransport } from '../logger.service'

describe('resolveLogOutput', () => {
  it('[BIZ] 未配置时默认 stdout，显式值保持可控', () => {
    expect(resolveLogOutput(undefined)).toBe('stdout')
    expect(resolveLogOutput('file')).toBe('file')
    expect(resolveLogOutput(' BOTH ')).toBe('both')
  })

  it('[VAL] 非法日志输出目标在启动期失败', () => {
    expect(() => resolveLogOutput('network')).toThrow('LOG_OUTPUT')
  })

  it('[BIZ] stdout-only 不创建文件 transport，兼容只读生产根目录', () => {
    expect(usesFileLogTransport('stdout')).toBe(false)
    expect(usesFileLogTransport('file')).toBe(true)
    expect(usesFileLogTransport('both')).toBe(true)
  })
})
