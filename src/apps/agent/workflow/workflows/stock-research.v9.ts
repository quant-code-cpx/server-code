import { AGENT_V9_TOOL_KEYS } from '../../contracts/tool-keys'
import type { WorkflowDefinition } from '../workflow.types'
import {
  RESEARCH_PLAN_SCHEMA_V5,
  STOCK_RESEARCH_PROMPT_V6,
  STOCK_RESEARCH_WORKFLOW_DEFINITIONS as LEGACY_STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V8,
} from './stock-research.v8'

export const RESEARCH_PLAN_SCHEMA_V6: Record<string, unknown> = Object.freeze({
  ...RESEARCH_PLAN_SCHEMA_V5,
  properties: {
    ...(RESEARCH_PLAN_SCHEMA_V5.properties as Record<string, unknown>),
    toolCalls: {
      ...((RESEARCH_PLAN_SCHEMA_V5.properties as Record<string, Record<string, unknown>>).toolCalls ?? {}),
      items: {
        ...(((RESEARCH_PLAN_SCHEMA_V5.properties as Record<string, Record<string, unknown>>).toolCalls?.items as Record<
          string,
          unknown
        >) ?? {}),
        properties: {
          ...((
            ((RESEARCH_PLAN_SCHEMA_V5.properties as Record<string, Record<string, unknown>>).toolCalls?.items as Record<
              string,
              Record<string, unknown>
            >) ?? {}
          ).properties as Record<string, unknown>),
          toolKey: { enum: [...AGENT_V9_TOOL_KEYS] },
        },
      },
    },
  },
})

export const STOCK_RESEARCH_PROMPT_V7 = Object.freeze({
  ...STOCK_RESEARCH_PROMPT_V6,
  version: 7,
  template: [
    STOCK_RESEARCH_PROMPT_V6.template,
    'For persisted backtest basics use get_backtest_result@1; for Monte Carlo, Brinson attribution, cost sensitivity, parameter sweep, walk-forward, or comparison diagnostics use get_backtest_analytics@1 and never create a job.',
    'For current portfolio risk use get_portfolio_risk@1; for point-in-time performance, PnL, drift, or immutable holding events use get_portfolio_analytics@1.',
    'When the user explicitly asks to save the report, save_research_report@1 must be an optional proposal. Its OPEN_REPORT_PREVIEW event is queued until agent.completed. Never treat chat text as confirmation and never request or expose a confirmation token.',
  ].join('\n'),
})

export const STOCK_RESEARCH_WORKFLOW_V9: WorkflowDefinition = Object.freeze({
  ...STOCK_RESEARCH_WORKFLOW_V8,
  version: 9,
  capabilityCatalogVersion: 4,
  toolAllowlist: Object.freeze([...AGENT_V9_TOOL_KEYS]),
  planSchema: RESEARCH_PLAN_SCHEMA_V6,
  prompt: STOCK_RESEARCH_PROMPT_V7,
})

export const STOCK_RESEARCH_WORKFLOW_CURRENT = STOCK_RESEARCH_WORKFLOW_V9

export const STOCK_RESEARCH_WORKFLOW_DEFINITIONS = Object.freeze([
  ...LEGACY_STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V9,
])
