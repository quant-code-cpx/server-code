import { AGENT_V8_TOOL_KEYS } from '../../contracts/tool-keys'
import type { WorkflowDefinition } from '../workflow.types'
import {
  RESEARCH_PLAN_SCHEMA_V4,
  STOCK_RESEARCH_PROMPT_V5,
  STOCK_RESEARCH_WORKFLOW_DEFINITIONS as LEGACY_STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V7,
} from './stock-research.v7'

export const RESEARCH_PLAN_SCHEMA_V5: Record<string, unknown> = Object.freeze({
  ...RESEARCH_PLAN_SCHEMA_V4,
  properties: {
    ...(RESEARCH_PLAN_SCHEMA_V4.properties as Record<string, unknown>),
    toolCalls: {
      ...((RESEARCH_PLAN_SCHEMA_V4.properties as Record<string, Record<string, unknown>>).toolCalls ?? {}),
      items: {
        ...(((RESEARCH_PLAN_SCHEMA_V4.properties as Record<string, Record<string, unknown>>).toolCalls?.items as Record<
          string,
          unknown
        >) ?? {}),
        properties: {
          ...((
            ((RESEARCH_PLAN_SCHEMA_V4.properties as Record<string, Record<string, unknown>>).toolCalls?.items as Record<
              string,
              Record<string, unknown>
            >) ?? {}
          ).properties as Record<string, unknown>),
          toolKey: { enum: [...AGENT_V8_TOOL_KEYS] },
        },
      },
    },
  },
})

export const STOCK_RESEARCH_PROMPT_V6 = Object.freeze({
  ...STOCK_RESEARCH_PROMPT_V5,
  version: 6,
  template: [
    STOCK_RESEARCH_PROMPT_V5.template,
    'For option contract lookup or daily history use get_option_market@1; never infer an underlying mapping, IV, Greeks, or a complete option chain.',
    'For convertible-bond basics or history use get_convertible_bond_market@1 only when enabled; preserve its per-bond coverage warnings.',
    'For abnormal returns around a fixed supported event use run_event_study@1; use get_stock_events@1 when the user only asks for raw event records.',
    'Use search_web@1 followed by fetch_web_page@1 only when the configured external provider is enabled and fresh public-web evidence is needed.',
  ].join('\n'),
})

export const STOCK_RESEARCH_WORKFLOW_V8: WorkflowDefinition = Object.freeze({
  ...STOCK_RESEARCH_WORKFLOW_V7,
  version: 8,
  capabilityCatalogVersion: 3,
  toolAllowlist: Object.freeze([...AGENT_V8_TOOL_KEYS]),
  planSchema: RESEARCH_PLAN_SCHEMA_V5,
  prompt: STOCK_RESEARCH_PROMPT_V6,
})

export const STOCK_RESEARCH_WORKFLOW_CURRENT = STOCK_RESEARCH_WORKFLOW_V8

export const STOCK_RESEARCH_WORKFLOW_DEFINITIONS = Object.freeze([
  ...LEGACY_STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V8,
])
