import type { AiAgentStepKind, UserRole, UserStatus } from '@prisma/client'
import type { AgentCapability, AgentToolKey, MessageBlock } from '../contracts'
import type { ModelDescriptor } from '../model-gateway/model-gateway.port'
import type { ToolRegistryPin } from '../tools/contracts/tool-definition'

export const STOCK_RESEARCH_NODE_KEYS = [
  'load_context',
  'plan',
  'authorize_tools',
  'execute_tools',
  'synthesize',
  'validate_citations',
  'persist',
  'complete',
] as const

export const STOCK_RESEARCH_V6_NODE_KEYS = [
  'load_context',
  'select_tools',
  'plan',
  'authorize_tools',
  'execute_tools',
  'synthesize',
  'validate_citations',
  'persist',
  'complete',
] as const

export type StockResearchNodeKey =
  | (typeof STOCK_RESEARCH_NODE_KEYS)[number]
  | (typeof STOCK_RESEARCH_V6_NODE_KEYS)[number]

export interface WorkflowNodeDefinition {
  key: StockResearchNodeKey
  kind: AiAgentStepKind
  label: string
}

export interface WorkflowPromptDefinition {
  key: string
  version: number
  template: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
}

export interface WorkflowDefinition {
  key: string
  version: number
  inputSchemaVersion: string
  maxSteps: number
  maxParallelTools: number
  toolAllowlist: readonly AgentToolKey[]
  planSchema: Record<string, unknown>
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  prompt: WorkflowPromptDefinition
  nodes: readonly WorkflowNodeDefinition[]
  capabilityCatalogVersion?: number
}

export interface FrozenWorkflowDefinition extends WorkflowDefinition {
  contentHash: string
  promptContentHash: string
}

export interface ResearchPlanToolCall {
  id: string
  toolKey: AgentToolKey
  toolVersion: number
  input: Record<string, unknown>
  dependsOn: string[]
  optional: boolean
}

export interface ResearchPlan {
  intent: string
  summary: string
  toolCalls: ResearchPlanToolCall[]
}

export interface CompiledResearchPlan extends ResearchPlan {
  executionLevels: string[][]
  toolPins: ToolRegistryPin[]
}

export interface LoadedWorkflowContext {
  userId: number
  role: UserRole
  userStatus: UserStatus
  conversationId: string
  triggerMessageId: string
  responseMessageId: string
  userText: string
  systemPolicy: string
  workflowPrompt: ContextWorkflowPrompt
  conversationState: Record<string, unknown>
  summary: ContextSummary | null
  recentMessages: ContextRecentMessage[]
  activeMemories: ContextUserMemory[]
  retrievedSources: ContextRetrievedSource[]
  allowedCapabilities: AgentCapability[]
  allowedScopes: string[]
  pageContext: Record<string, unknown>
  dataCutoff: string | null
  contextTokenCount: number
  manifest: ContextManifest
  warnings: string[]
}

export interface ContextWorkflowPrompt {
  workflowKey: string
  workflowVersion: number
  workflowHash: string
  promptVersionId: string
  promptKey: string
  promptVersion: number
  promptHash: string
  template: string
}

export interface ContextSummary {
  id: string
  version: number
  fromMessageId: string
  throughMessageId: string
  promptVersionId: string
  summaryText: string
  facts: unknown[]
  sourceMessageIds: string[]
  contentHash: string
}

export interface ContextRecentMessage {
  id?: string
  role: string
  content: string
  createdAt?: string
  contentHash?: string
}

export interface ContextUserMemory {
  id: string
  category: string
  key: string
  value: unknown
  sensitivity: string
  version: number
  validFrom: string
  expiresAt: string | null
  sourceConversationId: string | null
  sourceMessageId: string | null
  contentHash: string
}

export interface ContextRetrievedSource {
  sourceType: 'MEMORY' | 'REPORT'
  sourceId: string
  chunkIndex: number
  content: string
  contentHash: string
  citationIds: string[]
  scores: {
    fts: number | null
    vector: number | null
    hybrid: number
  }
  metadata: Record<string, unknown>
}

export type ContextSegmentKind =
  | 'SYSTEM_POLICY'
  | 'WORKFLOW_PROMPT'
  | 'PAGE_AND_STATE'
  | 'CONVERSATION_SUMMARY'
  | 'RECENT_MESSAGES'
  | 'COMPLETED_TOOL_FACTS'
  | 'ACTIVE_USER_MEMORIES'
  | 'RETRIEVED_SOURCES'

export interface ContextManifestSegment {
  kind: ContextSegmentKind
  ids: string[]
  contentHash: string
  tokenCount: number
}

export interface ContextManifest {
  schemaVersion: 1
  runId: string
  conversationId: string
  budgetTokens: number
  totalTokens: number
  contentHash: string
  segments: ContextManifestSegment[]
  warnings: string[]
}

export interface FactPacket {
  factId: string
  toolCallId: string
  toolKey: AgentToolKey
  title: string
  sourceType: 'DATABASE' | 'PROGRAM_CALCULATION' | 'OFFICIAL' | 'MEDIA' | 'INSTITUTION'
  sourceIds: string[]
  summary: string
  retrievedAt: string
  asOf: Record<string, string>
  timezone: string
  warnings: string[]
}

export interface FinalAnswerClaim {
  claimKey: string
  text: string
  factIds: string[]
}

export interface FinalAnswerDraft {
  markdown: string
  claims: FinalAnswerClaim[]
  warnings: string[]
  dataCutoff: string | null
}

export interface WorkflowCitationDraft {
  publicId: string
  blockId: string
  claimKey: string
  conclusionLevel: 'FACT' | 'PROGRAM_CALCULATION' | 'MODEL_INFERENCE' | 'SCENARIO'
  locator: Record<string, unknown>
  searchSourceId?: string | null
  toolCallId?: string | null
  sourceType?: FactPacket['sourceType']
  sourceTitle?: string
  retrievedAt: string
}

export interface WorkflowFinalization {
  contentText: string
  contentBlocks: MessageBlock[]
  citations: WorkflowCitationDraft[]
  modelName: string | null
  tokenCount: number
  dataCutoff: string | null
}

export interface WorkflowBudgetLimits {
  maxSteps: number
  maxToolCalls: number
  maxParallelTools: number
  /** 单个 Run 跨模型调用累计输入 Token 的成本/执行护栏；null 表示不启用。 */
  maxCumulativeInputTokens: number | null
  inputTokenGuardrailSource: 'RUN_SNAPSHOT' | 'LEGACY_RUN' | 'ENV' | 'LEGACY_ENV' | 'DISABLED_BY_DEFAULT'
  maxCost: number
  costCurrency: string
}

export interface WorkflowBudgetUsage {
  steps: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  cost: number
  costCurrency: string
  accountingWarnings?: string[]
}

export interface WorkflowModelProfile {
  schemaVersion?: 1
  snapshottedAt?: string
  source?: 'RUN_CREATION' | 'LEGACY_RUNTIME'
  selectedProvider: string
  selectedModel: string
  candidates: ModelDescriptor[]
}

export interface WorkflowExecutionState {
  modelProfile?: WorkflowModelProfile | null
  context: LoadedWorkflowContext | null
  plan: ResearchPlan | null
  compiledPlan: CompiledResearchPlan | null
  toolSnapshotSignature: string | null
  toolSelection?: ToolSelectionAudit | null
  facts: FactPacket[]
  draft: FinalAnswerDraft | null
  finalModelCallId: string | null
  modelName: string | null
  finalization: WorkflowFinalization | null
  warnings: string[]
  citationRepairAttempts: number
  budget: WorkflowBudgetUsage
}

export interface ToolSelectionAudit {
  catalogVersion: number
  catalogHash: string
  selectionPromptVersion: 1 | 2 | 3 | 4
  packs: string[]
  toolKeys: AgentToolKey[]
  reason: string
  fallback: boolean
  modelName: string | null
}

export interface WorkflowCheckpoint {
  schemaVersion: 1
  workflowKey: string
  workflowVersion: number
  workflowHash: string
  nextNodeIndex: number
  state: WorkflowExecutionState
}

export interface WorkflowTerminalResult {
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED'
  runId: string
  finalMessageId?: string
}
