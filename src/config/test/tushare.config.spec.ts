import { parseStkFactorMinIntervalMs } from '../tushare.config'

describe('TushareConfig stk_factor 限流', () => {
  it('[BIZ] 缺省使用 650ms，允许高积分账号显式设置到 120ms', () => {
    expect(parseStkFactorMinIntervalMs(undefined)).toBe(650)
    expect(parseStkFactorMinIntervalMs('120')).toBe(120)
  })

  it.each(['0', '119', '650.5', 'abc', '60001'])('[ERR] 非法配置 %s 必须在启动时失败', (value) => {
    expect(() => parseStkFactorMinIntervalMs(value)).toThrow('TUSHARE_STK_FACTOR_MIN_INTERVAL_MS')
  })
})
