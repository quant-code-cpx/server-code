import { AGENT_LEGACY_TOOL_KEYS, AGENT_V5_TOOL_KEYS } from '../../contracts/tool-keys'
import type { WorkflowDefinition } from '../workflow.types'
import {
  FINAL_ANSWER_SCHEMA,
  RESEARCH_PLAN_SCHEMA_V2,
  STOCK_RESEARCH_PROMPT_V1,
  STOCK_RESEARCH_WORKFLOW_V1,
} from './stock-research.v1'

export const STOCK_RESEARCH_WORKFLOW_V2: WorkflowDefinition = Object.freeze({
  ...STOCK_RESEARCH_WORKFLOW_V1,
  version: 2,
  toolAllowlist: Object.freeze([...AGENT_LEGACY_TOOL_KEYS.filter((key) => key !== 'screen_stocks')]),
})

export const STOCK_RESEARCH_WORKFLOW_V3: WorkflowDefinition = Object.freeze({
  ...STOCK_RESEARCH_WORKFLOW_V2,
  version: 3,
  toolAllowlist: Object.freeze([...AGENT_LEGACY_TOOL_KEYS]),
})

export const FINAL_ANSWER_SCHEMA_V2: Record<string, unknown> = Object.freeze({
  ...FINAL_ANSWER_SCHEMA,
  properties: {
    ...(FINAL_ANSWER_SCHEMA.properties as Record<string, unknown>),
    markdown: { type: 'string', minLength: 1, maxLength: 8_000 },
    claims: {
      ...((FINAL_ANSWER_SCHEMA.properties as Record<string, Record<string, unknown>>).claims ?? {}),
      maxItems: 30,
    },
    warnings: {
      ...((FINAL_ANSWER_SCHEMA.properties as Record<string, Record<string, unknown>>).warnings ?? {}),
      maxItems: 30,
    },
  },
})

export const STOCK_RESEARCH_PROMPT_V2 = Object.freeze({
  ...STOCK_RESEARCH_PROMPT_V1,
  version: 2,
  template: [
    STOCK_RESEARCH_PROMPT_V1.template,
    'Keep the final markdown concise and within 8000 characters.',
    'For full-market buy-signal ranking, use one screen_stocks call with preset=buy_signal_ranking.',
  ].join('\n'),
  outputSchema: FINAL_ANSWER_SCHEMA_V2,
})

export const STOCK_RESEARCH_WORKFLOW_V4: WorkflowDefinition = Object.freeze({
  ...STOCK_RESEARCH_WORKFLOW_V3,
  version: 4,
  outputSchema: FINAL_ANSWER_SCHEMA_V2,
  prompt: STOCK_RESEARCH_PROMPT_V2,
})

export const STOCK_RESEARCH_PROMPT_V3 = Object.freeze({
  ...STOCK_RESEARCH_PROMPT_V2,
  version: 3,
  template: [
    STOCK_RESEARCH_PROMPT_V2.template,
    'For exact MACD, KDJ, RSI, or BOLL values of one stock, use get_stock_technical_indicators@1.',
    'For current or historical standard signal events of one stock, use get_stock_technical_signals@1.',
    'For coverage, watermark, freshness, or missing-data explanations, use get_data_availability@1 only when needed.',
    'For full-market ranking or heuristic screening, use screen_stocks@2. Do not infer that a stock has no standard signal merely because it is absent from a ranking.',
    'Never call screen_stocks for an exact single-stock standard-signal question.',
  ].join('\n'),
})

export const STOCK_RESEARCH_WORKFLOW_V5: WorkflowDefinition = Object.freeze({
  ...STOCK_RESEARCH_WORKFLOW_V4,
  version: 5,
  planSchema: RESEARCH_PLAN_SCHEMA_V2,
  toolAllowlist: Object.freeze([...AGENT_V5_TOOL_KEYS]),
  prompt: STOCK_RESEARCH_PROMPT_V3,
})

export const STOCK_RESEARCH_WORKFLOW_CURRENT = STOCK_RESEARCH_WORKFLOW_V5

export const STOCK_RESEARCH_WORKFLOW_DEFINITIONS = Object.freeze([
  STOCK_RESEARCH_WORKFLOW_V1,
  STOCK_RESEARCH_WORKFLOW_V2,
  STOCK_RESEARCH_WORKFLOW_V3,
  STOCK_RESEARCH_WORKFLOW_V4,
  STOCK_RESEARCH_WORKFLOW_V5,
])
