import {
  assertAgentPerformanceGate,
  calculateAgentPerformanceMetrics,
  parseAgentPerformanceConfig,
} from '../agent-perf-metrics'

describe('Agent PERF metrics', () => {
  it('按 nearest-rank 独立计算平均值、p50/p95/p99、吞吐和错误率', () => {
    expect(
      calculateAgentPerformanceMetrics({
        latenciesMs: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
        errors: 0,
        wallTimeMs: 2_000,
      }),
    ).toEqual({
      attempts: 10,
      errors: 0,
      errorRate: 0,
      averageMs: 55,
      p50Ms: 50,
      p95Ms: 100,
      p99Ms: 100,
      maxMs: 100,
      throughputPerSecond: 5,
    })

    expect(
      calculateAgentPerformanceMetrics({
        latenciesMs: [10, 20, 30, 40],
        errors: 1,
        wallTimeMs: 1_000,
        throughputCount: 300,
      }),
    ).toMatchObject({ attempts: 4, errors: 1, errorRate: 0.25, throughputPerSecond: 300 })
  })

  it('默认 baseline 只强制零错误；gate 阈值全部来自显式环境配置', () => {
    expect(parseAgentPerformanceConfig({})).toEqual({
      mode: 'baseline',
      maxErrorRate: 0,
      thresholds: { rest: {}, run: {}, replay: {} },
    })

    expect(
      parseAgentPerformanceConfig({
        AGENT_PERF_MODE: 'gate',
        AGENT_PERF_MAX_ERROR_RATE: '0.01',
        AGENT_PERF_REST_MAX_P95_MS: '250',
        AGENT_PERF_REST_MAX_P99_MS: '500',
        AGENT_PERF_REST_MIN_RPS: '20',
        AGENT_PERF_RUN_MAX_P95_MS: '3000',
        AGENT_PERF_RUN_MAX_P99_MS: '5000',
        AGENT_PERF_RUN_MIN_RPS: '2',
        AGENT_PERF_REPLAY_MAX_P95_MS: '300',
        AGENT_PERF_REPLAY_MAX_P99_MS: '600',
        AGENT_PERF_REPLAY_MIN_EPS: '1000',
      }),
    ).toEqual({
      mode: 'gate',
      maxErrorRate: 0.01,
      thresholds: {
        rest: { maxP95Ms: 250, maxP99Ms: 500, minThroughputPerSecond: 20 },
        run: { maxP95Ms: 3000, maxP99Ms: 5000, minThroughputPerSecond: 2 },
        replay: { maxP95Ms: 300, maxP99Ms: 600, minThroughputPerSecond: 1000 },
      },
    })
    expect(() => parseAgentPerformanceConfig({ AGENT_PERF_MODE: 'gate' })).toThrow('至少配置一个产品阈值')
    expect(() => parseAgentPerformanceConfig({ AGENT_PERF_REST_MAX_P95_MS: '0' })).toThrow('AGENT_PERF_REST_MAX_P95_MS')
  })

  it('baseline 不应用延迟阈值；错误率和 gate 阈值失败时给出明确指标', () => {
    const metrics = calculateAgentPerformanceMetrics({
      latenciesMs: [100, 200, 300],
      errors: 0,
      wallTimeMs: 1_000,
    })
    expect(() =>
      assertAgentPerformanceGate('REST create', metrics, {
        mode: 'baseline',
        maxErrorRate: 0,
        thresholds: { maxP95Ms: 1, maxP99Ms: 1, minThroughputPerSecond: 100 },
      }),
    ).not.toThrow()
    expect(() =>
      assertAgentPerformanceGate('REST create', metrics, {
        mode: 'gate',
        maxErrorRate: 0,
        thresholds: { maxP95Ms: 250 },
      }),
    ).toThrow('p95 300ms > 250ms')

    const failed = calculateAgentPerformanceMetrics({ latenciesMs: [10, 20], errors: 1, wallTimeMs: 100 })
    expect(() =>
      assertAgentPerformanceGate('REST status', failed, {
        mode: 'baseline',
        maxErrorRate: 0,
        thresholds: {},
      }),
    ).toThrow('错误率 50% > 0%')
  })
})
