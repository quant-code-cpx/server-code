import { AGENT_ERROR_DEFINITIONS } from './agent-errors'
import { AGENT_SSE_EVENT_SCHEMA } from './agent-events'
import {
  AGENT_CAPABILITIES,
  AGENT_RUN_STATUSES,
  AGENT_STEP_STATUSES,
  CONVERSATION_STATUSES,
  MESSAGE_ROLES,
  MESSAGE_STATUSES,
  MODEL_CALL_STATUSES,
  MODEL_POLICIES,
  TOOL_CALL_STATUSES,
} from './agent-status'
import { CITATION_SCHEMA, DATA_PROVENANCE_SCHEMA, MESSAGE_BLOCK_SCHEMA } from './message-blocks'
import { AGENT_TOOL_KEYS } from './tool-keys'
import type { JsonSchema } from './runtime-schema'

export const AGENT_CONTRACT_SCHEMA_VERSION = '1.0' as const

export const AGENT_CONTRACT_JSON_SCHEMA: JsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://quant.local/schemas/agent-contracts-1.0.json',
  title: 'Quant Agent Public Contracts',
  schemaVersion: AGENT_CONTRACT_SCHEMA_VERSION,
  definitions: {
    AgentSseEvent: AGENT_SSE_EVENT_SCHEMA,
    MessageBlock: MESSAGE_BLOCK_SCHEMA,
    DataProvenance: DATA_PROVENANCE_SCHEMA,
    Citation: CITATION_SCHEMA,
  },
  enums: {
    conversationStatus: [...CONVERSATION_STATUSES],
    messageRole: [...MESSAGE_ROLES],
    messageStatus: [...MESSAGE_STATUSES],
    runStatus: [...AGENT_RUN_STATUSES],
    stepStatus: [...AGENT_STEP_STATUSES],
    toolCallStatus: [...TOOL_CALL_STATUSES],
    modelCallStatus: [...MODEL_CALL_STATUSES],
    modelPolicy: [...MODEL_POLICIES],
    capability: [...AGENT_CAPABILITIES],
    toolKey: [...AGENT_TOOL_KEYS],
  },
  errors: AGENT_ERROR_DEFINITIONS,
}
