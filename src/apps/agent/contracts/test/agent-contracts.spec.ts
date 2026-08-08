import { ErrorEnum } from 'src/constant/response-code.constant'
import {
  AGENT_ERROR_DEFINITIONS,
  AGENT_EVENT_FIXTURES,
  AGENT_EVENT_TYPES,
  AGENT_MVP_READ_TOOL_KEYS,
  AGENT_RUN_STATUSES,
  AGENT_TOOL_KEYS,
  AGENT_V6_TOOL_KEYS,
  AGENT_V7_TOOL_KEYS,
  MESSAGE_BLOCK_FIXTURES,
  MODEL_CALL_STATUSES,
  TOOL_CALL_STATUSES,
  AgentProtocolError,
  parseAgentSseEvent,
  parseMessageBlock,
} from '..'

describe('Agent 公共契约', () => {
  it('固定 MVP 只读 Tool key，受控写 Tool 单独声明', () => {
    expect(AGENT_MVP_READ_TOOL_KEYS).toEqual([
      'resolve_security',
      'get_stock_price_history',
      'get_stock_overview',
      'screen_stocks',
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
    expect(AGENT_TOOL_KEYS).toContain('save_research_report')
    expect(AGENT_TOOL_KEYS).toEqual(
      expect.arrayContaining([
        'get_index_market_data',
        'get_fund_research',
        'get_industry_rotation',
        'get_factor_analysis',
        'get_macro_snapshot',
        'get_option_market',
        'get_convertible_bond_market',
        'run_event_study',
      ]),
    )
    expect(AGENT_V6_TOOL_KEYS).not.toContain('get_macro_snapshot')
    expect(AGENT_V7_TOOL_KEYS).not.toContain('run_event_study')
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

  it('SSE fixture 全部通过 runtime schema', () => {
    expect(AGENT_EVENT_FIXTURES.map((event) => event.type)).toEqual(AGENT_EVENT_TYPES)
    for (const fixture of AGENT_EVENT_FIXTURES) {
      expect(parseAgentSseEvent(fixture)).toEqual(fixture)
    }
  })

  it('旧版 agent.planning 事件缺少公开决策字段时仍可回放', () => {
    const fixture = AGENT_EVENT_FIXTURES.find((event) => event.type === 'agent.planning')
    if (!fixture || fixture.type !== 'agent.planning') throw new Error('agent.planning fixture 缺失')
    const { decision: _decision, ...legacyPayload } = fixture.payload
    expect(_decision).toBeDefined()

    expect(parseAgentSseEvent({ ...fixture, payload: legacyPayload })).toEqual({
      ...fixture,
      payload: legacyPayload,
    })
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
    expect(_provenance).toBeDefined()
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

  it('6001–6049 与 6099 全部进入 ErrorEnum，且 code 不重复', () => {
    const expectedCodes = [...Array.from({ length: 49 }, (_value, index) => 6001 + index), 6099]
    expect(AGENT_ERROR_DEFINITIONS.map((definition) => definition.code)).toEqual(expectedCodes)
    expect(new Set(AGENT_ERROR_DEFINITIONS.map((definition) => definition.code))).toHaveProperty(
      'size',
      expectedCodes.length,
    )
    for (const definition of AGENT_ERROR_DEFINITIONS) {
      expect(ErrorEnum[definition.key]).toBe(`${definition.code}:${definition.message}`)
    }
  })
})
