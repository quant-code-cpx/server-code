import { AGENT_V7_TOOL_KEYS } from '../../contracts/tool-keys'
import type { WorkflowDefinition } from '../workflow.types'
import {
  RESEARCH_PLAN_SCHEMA_V3,
  STOCK_RESEARCH_PROMPT_V4,
  STOCK_RESEARCH_WORKFLOW_DEFINITIONS as LEGACY_STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V6,
} from './stock-research.v6'

export const RESEARCH_PLAN_SCHEMA_V4: Record<string, unknown> = Object.freeze({
  ...RESEARCH_PLAN_SCHEMA_V3,
  properties: {
    ...(RESEARCH_PLAN_SCHEMA_V3.properties as Record<string, unknown>),
    toolCalls: {
      ...((RESEARCH_PLAN_SCHEMA_V3.properties as Record<string, Record<string, unknown>>).toolCalls ?? {}),
      items: {
        ...(((RESEARCH_PLAN_SCHEMA_V3.properties as Record<string, Record<string, unknown>>).toolCalls?.items as Record<
          string,
          unknown
        >) ?? {}),
        properties: {
          ...((
            ((RESEARCH_PLAN_SCHEMA_V3.properties as Record<string, Record<string, unknown>>).toolCalls?.items as Record<
              string,
              Record<string, unknown>
            >) ?? {}
          ).properties as Record<string, unknown>),
          toolKey: { enum: [...AGENT_V7_TOOL_KEYS] },
        },
      },
    },
  },
})

export const STOCK_RESEARCH_PROMPT_V5 = Object.freeze({
  ...STOCK_RESEARCH_PROMPT_V4,
  version: 5,
  template: [
    STOCK_RESEARCH_PROMPT_V4.template,
    'For index quotes, history, valuation, or constituents use get_index_market_data@1; do not route an index to stock-price tools.',
    'For public fund NAV, exchange price, share, holdings, or estimated ETF flow use get_fund_research@1.',
    'For THS industry return, momentum, flow, valuation, or heatmap use get_industry_rotation@1 and preserve source labels.',
    'For built-in factor values, IC, quantiles, decay, distribution, or correlation use get_factor_analysis@1; never invent custom expressions.',
    'For CPI, PPI, GDP, or SHIBOR use get_macro_snapshot@1; systemKnownAt is not an official publication date.',
  ].join('\n'),
})

export const STOCK_RESEARCH_WORKFLOW_V7: WorkflowDefinition = Object.freeze({
  ...STOCK_RESEARCH_WORKFLOW_V6,
  version: 7,
  capabilityCatalogVersion: 2,
  toolAllowlist: Object.freeze([...AGENT_V7_TOOL_KEYS]),
  planSchema: RESEARCH_PLAN_SCHEMA_V4,
  prompt: STOCK_RESEARCH_PROMPT_V5,
})

export const STOCK_RESEARCH_WORKFLOW_CURRENT = STOCK_RESEARCH_WORKFLOW_V7

export const STOCK_RESEARCH_WORKFLOW_DEFINITIONS = Object.freeze([
  ...LEGACY_STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V7,
])
