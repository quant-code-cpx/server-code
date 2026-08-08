import { AGENT_V9_TOOL_KEYS } from '../../contracts/tool-keys'
import { STOCK_RESEARCH_WORKFLOW_V10 } from '../workflows/stock-research.v10'
import {
  STOCK_RESEARCH_PROMPT_V9,
  STOCK_RESEARCH_WORKFLOW_CURRENT,
  STOCK_RESEARCH_WORKFLOW_V11,
} from '../workflows/stock-research.v11'

describe('stock_research workflow v11 新闻能力', () => {
  it('历史 v10 不变，新 v11 才开放 get_market_news@1', () => {
    expect(STOCK_RESEARCH_WORKFLOW_V10.toolAllowlist).toEqual(expect.arrayContaining([...AGENT_V9_TOOL_KEYS]))
    expect(STOCK_RESEARCH_WORKFLOW_V10.toolAllowlist).not.toContain('get_market_news')
    expect(STOCK_RESEARCH_WORKFLOW_CURRENT).toBe(STOCK_RESEARCH_WORKFLOW_V11)
    expect(STOCK_RESEARCH_WORKFLOW_V11.version).toBe(11)
    expect(STOCK_RESEARCH_WORKFLOW_V11.toolAllowlist).toContain('get_market_news')
    expect(STOCK_RESEARCH_WORKFLOW_V11.toolAllowlist).toContain('get_convertible_bond_market')
    expect(STOCK_RESEARCH_PROMPT_V9.template).toContain('get_market_news@1 first')
  })
})
