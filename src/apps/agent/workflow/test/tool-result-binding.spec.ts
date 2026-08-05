import type { ToolResult } from '../../tools/contracts/tool-result'
import { resolveToolInputBindings } from '../tool-result-binding'

describe('resolveToolInputBindings', () => {
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
