import type { WorkflowDefinition } from '../workflow.types'
import { FINAL_ANSWER_SCHEMA_V2 } from './stock-research.v2'
import {
  STOCK_RESEARCH_PROMPT_V7,
  STOCK_RESEARCH_WORKFLOW_DEFINITIONS as LEGACY_STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V9,
} from './stock-research.v9'

const answerProperties = FINAL_ANSWER_SCHEMA_V2.properties as Record<string, Record<string, unknown>>
const claimItems = answerProperties.claims.items as Record<string, Record<string, unknown>>
const claimProperties = claimItems.properties as Record<string, Record<string, unknown>>

export const FINAL_ANSWER_SCHEMA_V3: Record<string, unknown> = Object.freeze({
  ...FINAL_ANSWER_SCHEMA_V2,
  properties: {
    ...answerProperties,
    markdown: { type: 'string', minLength: 1, maxLength: 3_000 },
    claims: {
      ...answerProperties.claims,
      maxItems: 10,
      items: {
        ...claimItems,
        properties: {
          ...claimProperties,
          claimKey: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z][A-Za-z0-9_.-]*$' },
          text: { type: 'string', minLength: 1, maxLength: 240 },
          factIds: {
            ...claimProperties.factIds,
            maxItems: 4,
            items: { type: 'string', minLength: 1, maxLength: 80 },
          },
        },
      },
    },
    warnings: {
      ...answerProperties.warnings,
      maxItems: 6,
      items: { type: 'string', minLength: 1, maxLength: 240 },
    },
  },
})

export const STOCK_RESEARCH_PROMPT_V8 = Object.freeze({
  ...STOCK_RESEARCH_PROMPT_V7,
  version: 8,
  template: [
    STOCK_RESEARCH_PROMPT_V7.template,
    'Keep a single-stock answer under 2000 Chinese characters. Use 3-8 concise claims, no more than 4 factIds per claim, and no more than 5 warnings.',
    'Do not enumerate every price-history row, repeat raw tool payloads, or duplicate the same evidence across claims.',
  ].join('\n'),
  outputSchema: FINAL_ANSWER_SCHEMA_V3,
})

export const STOCK_RESEARCH_WORKFLOW_V10: WorkflowDefinition = Object.freeze({
  ...STOCK_RESEARCH_WORKFLOW_V9,
  version: 10,
  outputSchema: FINAL_ANSWER_SCHEMA_V3,
  prompt: STOCK_RESEARCH_PROMPT_V8,
})

export const STOCK_RESEARCH_WORKFLOW_CURRENT = STOCK_RESEARCH_WORKFLOW_V10

export const STOCK_RESEARCH_WORKFLOW_DEFINITIONS = Object.freeze([
  ...LEGACY_STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V10,
])
