import { AGENT_TOOL_KEYS } from '../../contracts'
import type { WorkflowDefinition } from '../workflow.types'
import { FINAL_ANSWER_SCHEMA, STOCK_RESEARCH_PROMPT_V1, STOCK_RESEARCH_WORKFLOW_V1 } from './stock-research.v1'

export const STOCK_RESEARCH_WORKFLOW_V2: WorkflowDefinition = Object.freeze({
  ...STOCK_RESEARCH_WORKFLOW_V1,
  version: 2,
  toolAllowlist: Object.freeze([...AGENT_TOOL_KEYS.filter((key) => key !== 'screen_stocks')]),
})

export const STOCK_RESEARCH_WORKFLOW_V3: WorkflowDefinition = Object.freeze({
  ...STOCK_RESEARCH_WORKFLOW_V2,
  version: 3,
  toolAllowlist: Object.freeze([...AGENT_TOOL_KEYS]),
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

export const STOCK_RESEARCH_WORKFLOW_CURRENT = STOCK_RESEARCH_WORKFLOW_V4

export const STOCK_RESEARCH_WORKFLOW_DEFINITIONS = Object.freeze([
  STOCK_RESEARCH_WORKFLOW_V1,
  STOCK_RESEARCH_WORKFLOW_V2,
  STOCK_RESEARCH_WORKFLOW_V3,
  STOCK_RESEARCH_WORKFLOW_V4,
])
