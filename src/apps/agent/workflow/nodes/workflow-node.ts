import type { AgentExecutionRun } from '../../execution/agent-run.repository'
import type {
  FrozenWorkflowDefinition,
  StockResearchNodeKey,
  WorkflowBudgetLimits,
  WorkflowExecutionState,
} from '../workflow.types'

export interface WorkflowNodeExecutionContext {
  run: AgentExecutionRun
  workflow: FrozenWorkflowDefinition
  state: WorkflowExecutionState
  limits: WorkflowBudgetLimits
  stepId: string
  signal?: AbortSignal
}

export interface WorkflowNodeHandler {
  readonly key: StockResearchNodeKey
  execute(context: WorkflowNodeExecutionContext): Promise<WorkflowExecutionState>
}
