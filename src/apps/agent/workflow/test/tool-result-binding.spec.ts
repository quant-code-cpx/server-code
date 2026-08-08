import type { ToolResult } from '../../tools/contracts/tool-result'
import {
  cloneAndValidateToolInput,
  resolveToolInputBindings,
  ToolResultBindingEmptyCollectionError,
  ToolResultBindingUnavailableError,
} from '../tool-result-binding'

describe('resolveToolInputBindings', () => {
  it('将行情 bars 确定性投影为绩效计算 points', () => {
    const results = new Map<string, ToolResult>([
      [
        'history',
        toolResult({
          bars: [
            { tradeDate: '2026-08-06', close: 10.5, volume: 100 },
            { tradeDate: '2026-08-07', close: 10.8, volume: 120 },
          ],
        }),
      ],
    ])

    expect(
      resolveToolInputBindings(
        { points: { $toolResult: { callId: 'history', path: ['points'] } } },
        ['history'],
        results,
      ),
    ).toEqual({
      points: [
        { date: '2026-08-06', value: 10.5 },
        { date: '2026-08-07', value: 10.8 },
      ],
    })
  })

  it('兼容 resolve_security 的旧 results 绑定并解析为 candidates', () => {
    const results = new Map<string, ToolResult>([
      [
        'resolve',
        toolResult({
          query: '佰维存储',
          candidates: [{ tsCode: '688525.SH' }],
          ambiguous: false,
        }),
      ],
    ])

    expect(
      resolveToolInputBindings(
        { tsCode: { $toolResult: { callId: 'resolve', path: ['results', 0, 'tsCode'] } } },
        ['resolve'],
        results,
      ),
    ).toEqual({ tsCode: '688525.SH' })
  })

  it('兼容 get_sector_membership 的 sectors 绑定并解析为 items', () => {
    const results = new Map<string, ToolResult>([
      [
        'membership',
        toolResult({
          mode: 'SECTORS_FOR_SECURITY',
          items: [{ sectorCode: '801180.SI', sectorType: 'INDUSTRY' }],
        }),
      ],
    ])

    expect(
      resolveToolInputBindings(
        { sectorCode: { $toolResult: { callId: 'membership', path: ['sectors', 0, 'sectorCode'] } } },
        ['membership'],
        results,
      ),
    ).toEqual({ sectorCode: '801180.SI' })
  })

  it('兼容 get_market_snapshot 的 dataDates 绑定并解析最新交易日', () => {
    const results = new Map<string, ToolResult>([
      [
        'snapshot',
        toolResult({
          sections: [
            { section: 'INDEX_QUOTES', asOf: '2026-08-07', facts: [] },
            {
              section: 'DATA_DATES',
              asOf: '2026-08-07',
              facts: [{ key: 'daily', value: '2026-08-07' }],
            },
          ],
        }),
      ],
    ])

    expect(
      resolveToolInputBindings(
        { asOfDate: { $toolResult: { callId: 'snapshot', path: ['dataDates', 'latestTradeDate'] } } },
        ['snapshot'],
        results,
      ),
    ).toEqual({ asOfDate: '2026-08-07' })
  })

  it('未知绑定路径仍报错', () => {
    const results = new Map<string, ToolResult>([['resolve', toolResult({ candidates: [{ tsCode: '688525.SH' }] })]])

    expect(() =>
      resolveToolInputBindings(
        { tsCode: { $toolResult: { callId: 'resolve', path: ['results', 0, 'unknown'] } } },
        ['resolve'],
        results,
      ),
    ).toThrow('结果路径不存在')
  })

  it('依赖候选为空时返回可降级的类型化错误', () => {
    const results = new Map<string, ToolResult>([['resolve', toolResult({ candidates: [] })]])

    expect(() =>
      resolveToolInputBindings(
        { tsCode: { $toolResult: { callId: 'resolve', path: ['candidates', 0, 'tsCode'] } } },
        ['resolve'],
        results,
      ),
    ).toThrow(ToolResultBindingEmptyCollectionError)
  })

  it('[SEC] 克隆嵌套数组中的合法绑定，且不复用调用方可变 path', () => {
    const path = ['candidates', 0, 'tsCode']
    const input = {
      queries: [{ tsCode: { $toolResult: { callId: 'resolve', path } } }],
    }

    const cloned = cloneAndValidateToolInput(input, ['resolve'])
    path.push('tampered')

    expect(cloned).toEqual({
      queries: [{ tsCode: { $toolResult: { callId: 'resolve', path: ['candidates', 0, 'tsCode'] } } }],
    })
  })

  it.each([
    ['绑定对象混入额外字段', { $toolResult: { callId: 'resolve', path: ['candidates'] }, extra: true }],
    ['绑定缺少 path', { $toolResult: { callId: 'resolve' } }],
    ['绑定引用非直接依赖', { $toolResult: { callId: 'other', path: ['candidates'] } }],
    ['绑定 path 为空', { $toolResult: { callId: 'resolve', path: [] } }],
    ['绑定 path 含原型链 key', { $toolResult: { callId: 'resolve', path: ['constructor'] } }],
    ['绑定 path 含负索引', { $toolResult: { callId: 'resolve', path: [-1] } }],
  ])('[SEC] 拒绝%s', (_name, binding) => {
    expect(() => cloneAndValidateToolInput({ value: binding }, ['resolve'])).toThrow()
  })

  it('[SEC] 拒绝普通输入对象中的原型链 key', () => {
    expect(() => cloneAndValidateToolInput({ safe: { constructor: 'pollute' } }, [])).toThrow(
      '研究计划 Tool input key 非法：constructor',
    )
  })

  it('[EDGE] 输入嵌套超过上限时稳定拒绝', () => {
    let nested: Record<string, unknown> = { value: 'leaf' }
    for (let index = 0; index < 34; index += 1) nested = { child: nested }

    expect(() => cloneAndValidateToolInput(nested, [])).toThrow('研究计划 Tool input 嵌套过深')
  })

  it('[ERR] 依赖结果缺失与非空集合越界不会误判为空集合', () => {
    expect(() =>
      resolveToolInputBindings(
        { tsCode: { $toolResult: { callId: 'resolve', path: ['candidates', 0, 'tsCode'] } } },
        ['resolve'],
        new Map(),
      ),
    ).toThrow(ToolResultBindingUnavailableError)

    const nonEmpty = new Map<string, ToolResult>([['resolve', toolResult({ candidates: [{ tsCode: '688525.SH' }] })]])
    expect(() =>
      resolveToolInputBindings(
        { tsCode: { $toolResult: { callId: 'resolve', path: ['candidates', 1, 'tsCode'] } } },
        ['resolve'],
        nonEmpty,
      ),
    ).toThrow(ToolResultBindingUnavailableError)
  })
})

function toolResult(data: unknown): ToolResult {
  return {
    ok: true,
    toolCallId: 'tool_call_resolve',
    toolKey: 'resolve_security',
    toolVersion: 1,
    data,
    provenance: {
      sourceType: 'DATABASE',
      sourceServices: ['StockToolFacade'],
      sourceModels: ['stock_basic_profiles'],
      asOf: { retrievedAt: '2026-07-25T00:00:00.000Z' },
      timezone: 'Asia/Shanghai',
    },
    citationSourceIds: [],
    warnings: [],
    truncated: false,
  }
}
