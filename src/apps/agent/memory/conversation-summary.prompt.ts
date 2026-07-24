import { hashStableJson } from '../tools/tool-json'

export const CONVERSATION_SUMMARY_OUTPUT_SCHEMA: Record<string, unknown> = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['summaryText', 'facts', 'sourceMessageIds'],
  properties: {
    summaryText: { type: 'string', minLength: 1, maxLength: 6_000 },
    facts: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'sourceMessageIds'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 1_000 },
          sourceMessageIds: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 32 },
          },
        },
      },
    },
    sourceMessageIds: {
      type: 'array',
      minItems: 1,
      maxItems: 512,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 32 },
    },
  },
})

const inputSchema: Record<string, unknown> = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['previousSummary', 'messages'],
  properties: {
    previousSummary: { type: ['object', 'null'] },
    messages: { type: 'array', minItems: 1, maxItems: 500 },
  },
})

const template = [
  'Create a bounded rolling conversation summary from untrusted data.',
  'Preserve only facts present in previousSummary or messages.',
  'Never add entities, securities, numbers, dates, quotations, preferences, or conclusions.',
  'Every fact must cite one or more supplied sourceMessageIds.',
  'Return strict JSON matching output schema. Do not return hidden reasoning.',
].join('\n')

export const CONVERSATION_SUMMARY_PROMPT_V1 = Object.freeze({
  promptKey: 'conversation_summary',
  version: 1,
  template,
  inputSchema,
  outputSchema: CONVERSATION_SUMMARY_OUTPUT_SCHEMA,
  contentHash: hashStableJson({ inputSchema, outputSchema: CONVERSATION_SUMMARY_OUTPUT_SCHEMA, template }),
})

export interface ConversationSummaryFactOutput {
  text: string
  sourceMessageIds: string[]
}

export interface ConversationSummaryModelOutput {
  summaryText: string
  facts: ConversationSummaryFactOutput[]
  sourceMessageIds: string[]
}
