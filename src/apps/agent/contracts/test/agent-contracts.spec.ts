import { ErrorEnum } from 'src/constant/response-code.constant'
import {
  AGENT_ERROR_DEFINITIONS,
  AGENT_EVENT_FIXTURES,
  AGENT_EVENT_TYPES,
  AGENT_RUN_STATUSES,
  AGENT_TOOL_KEYS,
  MESSAGE_BLOCK_FIXTURES,
  MODEL_CALL_STATUSES,
  TOOL_CALL_STATUSES,
  AgentProtocolError,
  parseAgentSseEvent,
  parseMessageBlock,
} from '..'

describe('Agent 公共契约', () => {
  it('固定 15 个 MVP Tool key', () => {
    expect(AGENT_TOOL_KEYS).toEqual([
      'resolve_security',
      'get_stock_price_history',
      'get_stock_overview',
      'get_financial_statements',
      'get_financial_indicators',
      'get_stock_moneyflow',
      'get_market_snapshot',
      'get_sector_membership',
      'get_user_watchlist',
      'get_portfolio_risk',
      'get_backtest_result',
      'compute_performance_metrics',
      'compute_valuation_percentile',
      'search_web',
      'fetch_web_page',
    ])
  })

  it('Run、ToolCall、ModelCall 状态与 canonical 文档一致', () => {
    expect(AGENT_RUN_STATUSES).toEqual(['QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED'])
    expect(TOOL_CALL_STATUSES).toEqual([
      'PENDING',
      'AUTHORIZING',
      'RUNNING',
      'RETRY_WAIT',
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'REJECTED',
    ])
    expect(MODEL_CALL_STATUSES).toEqual(['PENDING', 'STREAMING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED'])
  })

  it('14 个 SSE fixture 全部通过 runtime schema', () => {
    expect(AGENT_EVENT_FIXTURES).toHaveLength(14)
    expect(AGENT_EVENT_FIXTURES.map((event) => event.type)).toEqual(AGENT_EVENT_TYPES)
    for (const fixture of AGENT_EVENT_FIXTURES) {
      expect(parseAgentSseEvent(fixture)).toEqual(fixture)
    }
  })

  it('未知 SSE event type 返回 typed protocol error', () => {
    expect(() => parseAgentSseEvent({ ...AGENT_EVENT_FIXTURES[0], type: 'agent.unknown' })).toThrow(AgentProtocolError)
  })

  it('sequence 超出 JS 安全整数时拒绝', () => {
    expect(() => parseAgentSseEvent({ ...AGENT_EVENT_FIXTURES[0], sequence: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      AgentProtocolError,
    )
  })

  it('6 类 MessageBlock fixture 全部通过 runtime schema', () => {
    expect(MESSAGE_BLOCK_FIXTURES).toHaveLength(6)
    for (const fixture of MESSAGE_BLOCK_FIXTURES) {
      expect(parseMessageBlock(fixture)).toEqual(fixture)
    }
  })

  it('结构化块缺 provenance 时拒绝', () => {
    const { provenance: _provenance, ...invalid } = MESSAGE_BLOCK_FIXTURES[1]
    expect(() => parseMessageBlock(invalid)).toThrow(AgentProtocolError)
  })

  it('Markdown raw HTML 被拒绝', () => {
    expect(() =>
      parseMessageBlock({
        blockId: 'unsafe',
        schemaVersion: 1,
        type: 'MARKDOWN',
        text: '<script>alert(1)</script>',
      }),
    ).toThrow(AgentProtocolError)
  })

  it('6001–6031 与 6099 全部进入 ErrorEnum，且 code 不重复', () => {
    expect(AGENT_ERROR_DEFINITIONS).toHaveLength(32)
    expect(new Set(AGENT_ERROR_DEFINITIONS.map((definition) => definition.code))).toHaveProperty('size', 32)
    for (const definition of AGENT_ERROR_DEFINITIONS) {
      expect(ErrorEnum[definition.key]).toBe(`${definition.code}:${definition.message}`)
    }
  })
})
