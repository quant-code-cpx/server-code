import type { AiAgentStepKind, UserRole, UserStatus } from '@prisma/client'
import type { AgentCapability, AgentToolKey, MessageBlock } from '../contracts'
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

export type StockResearchNodeKey = (typeof STOCK_RESEARCH_NODE_KEYS)[number]

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
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  prompt: WorkflowPromptDefinition
  nodes: readonly WorkflowNodeDefinition[]
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
  recentMessages: Array<{ role: string; content: string }>
  allowedCapabilities: AgentCapability[]
  allowedScopes: string[]
  pageContext: Record<string, unknown>
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
  maxInputTokens: number
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
}

export interface WorkflowExecutionState {
  context: LoadedWorkflowContext | null
  plan: ResearchPlan | null
  compiledPlan: CompiledResearchPlan | null
  toolSnapshotSignature: string | null
  facts: FactPacket[]
  draft: FinalAnswerDraft | null
  modelName: string | null
  finalization: WorkflowFinalization | null
  warnings: string[]
  citationRepairAttempts: number
  budget: WorkflowBudgetUsage
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
