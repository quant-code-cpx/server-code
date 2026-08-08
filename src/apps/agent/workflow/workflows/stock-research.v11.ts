import { AGENT_TOOL_KEYS } from '../../contracts/tool-keys'
import type { WorkflowDefinition } from '../workflow.types'
import {
  STOCK_RESEARCH_PROMPT_V8,
  STOCK_RESEARCH_WORKFLOW_DEFINITIONS as LEGACY_STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V10,
} from './stock-research.v10'
import { RESEARCH_PLAN_SCHEMA_V6 } from './stock-research.v9'

export const RESEARCH_PLAN_SCHEMA_V7: Record<string, unknown> = Object.freeze({
  ...RESEARCH_PLAN_SCHEMA_V6,
  properties: {
    ...(RESEARCH_PLAN_SCHEMA_V6.properties as Record<string, unknown>),
    toolCalls: {
      ...((RESEARCH_PLAN_SCHEMA_V6.properties as Record<string, Record<string, unknown>>).toolCalls ?? {}),
      items: {
        ...(((RESEARCH_PLAN_SCHEMA_V6.properties as Record<string, Record<string, unknown>>).toolCalls?.items as Record<
          string,
          unknown
        >) ?? {}),
        properties: {
          ...((
            ((RESEARCH_PLAN_SCHEMA_V6.properties as Record<string, Record<string, unknown>>).toolCalls?.items as Record<
              string,
              Record<string, unknown>
            >) ?? {}
          ).properties as Record<string, unknown>),
          toolKey: { enum: [...AGENT_TOOL_KEYS] },
        },
      },
    },
  },
})

export const STOCK_RESEARCH_PROMPT_V9 = Object.freeze({
  ...STOCK_RESEARCH_PROMPT_V8,
  version: 9,
  template: [
    STOCK_RESEARCH_PROMPT_V8.template,
    'For news, notices, flashes, current events, or event timelines, call get_market_news@1 first and state its local dataThrough and coverage warnings.',
    'get_market_news never accesses the internet. For high-risk claims, missing canonical URLs, source conflicts, or explicit latest verification, use search_web then fetch_web_page only when WEB_SEARCH is authorized.',
  ].join('\n'),
})

export const STOCK_RESEARCH_WORKFLOW_V11: WorkflowDefinition = Object.freeze({
  ...STOCK_RESEARCH_WORKFLOW_V10,
  version: 11,
  toolAllowlist: Object.freeze([...AGENT_TOOL_KEYS]),
  planSchema: RESEARCH_PLAN_SCHEMA_V7,
  prompt: STOCK_RESEARCH_PROMPT_V9,
})

export const STOCK_RESEARCH_WORKFLOW_CURRENT = STOCK_RESEARCH_WORKFLOW_V11

export const STOCK_RESEARCH_WORKFLOW_DEFINITIONS = Object.freeze([
  ...LEGACY_STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V11,
])
