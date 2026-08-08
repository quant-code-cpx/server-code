import { prepareNewsLocalConfig } from '../nonfunctional/news-local-config'

describe('News Round 3 本地联调配置准备', () => {
  const firstSecret = 'a'.repeat(64)
  const secondSecret = 'b'.repeat(64)

  it('NEWS-R3-LOCAL-001: 缺失配置时生成独立 secret，启用 News/AKShare 并保持 GDELT 关闭', () => {
    const generated = [firstSecret, secondSecret]
    const result = prepareNewsLocalConfig('DATABASE_URL=postgresql://local\n', {
      generateSecret: () => generated.shift() ?? 'unexpected',
    })

    const values = parseEnv(result.content)
    expect(values).toEqual(
      expect.objectContaining({
        NEWS_ENABLED: 'true',
        NEWS_AKSHARE_BRIDGE_ENABLED: 'true',
        NEWS_GDELT_ENABLED: 'false',
        NEWS_GDELT_MIN_INTERVAL_MS: '60000',
        NEWS_GDELT_TIMEOUT_MS: '60000',
        NEWS_CANARY_MONITOR_ENABLED: 'true',
        NEWS_CANARY_MONITOR_PROVIDERS: 'AKSHARE',
        NEWS_CANARY_MONITOR_AKSHARE_INTERVAL_MS: '86400000',
        NEWS_CANARY_MONITOR_GDELT_INTERVAL_MS: '900000',
        NEWS_CANARY_MONITOR_POLL_INTERVAL_MS: '60000',
        NEWS_CANARY_MONITOR_ONCE: 'false',
      }),
    )
    expect(values.NEWS_CURSOR_SECRET).toBe(firstSecret)
    expect(values.NEWS_AKSHARE_BRIDGE_TOKEN).toBe(secondSecret)
    expect(values.NEWS_CURSOR_SECRET).not.toBe(values.NEWS_AKSHARE_BRIDGE_TOKEN)
    expect(result.evidence).toEqual(
      expect.objectContaining({
        newsEnabled: true,
        akshareBridgeEnabled: true,
        gdeltEnabled: false,
        cursorSecretBytes: 64,
        bridgeTokenBytes: 64,
        gdeltMinIntervalMs: 60_000,
        gdeltTimeoutMs: 60_000,
      }),
    )
    expect(JSON.stringify(result.evidence)).not.toContain(firstSecret)
    expect(JSON.stringify(result.evidence)).not.toContain(secondSecret)
  })

  it('NEWS-R3-LOCAL-002: 合规 secret 被保留，重复执行幂等且不产生重复 key', () => {
    const original = [
      'NEWS_ENABLED=false',
      `NEWS_CURSOR_SECRET=${firstSecret}`,
      `NEWS_AKSHARE_BRIDGE_TOKEN=${secondSecret}`,
      'NEWS_GDELT_MIN_INTERVAL_MS=6000',
      'NEWS_ENABLED=false',
      '',
    ].join('\n')
    const generateSecret = jest.fn(() => 'c'.repeat(64))
    const first = prepareNewsLocalConfig(original, { generateSecret })
    const second = prepareNewsLocalConfig(first.content, { generateSecret })

    expect(generateSecret).not.toHaveBeenCalled()
    expect(second.content).toBe(first.content)
    expect(parseEnv(second.content)).toEqual(
      expect.objectContaining({
        NEWS_CURSOR_SECRET: firstSecret,
        NEWS_AKSHARE_BRIDGE_TOKEN: secondSecret,
      }),
    )
    for (const key of second.evidence.changedKeys) {
      expect(second.content.match(new RegExp(`^${key}=`, 'gm'))).toHaveLength(1)
    }
  })
})

function parseEnv(content: string): Record<string, string> {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }),
  )
}
