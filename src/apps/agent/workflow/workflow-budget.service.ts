import { Inject, Injectable } from '@nestjs/common'
import { AgentExecutionConfig, type IAgentExecutionConfig } from 'src/config/agent-execution.config'
import type { FrozenWorkflowDefinition, WorkflowBudgetLimits, WorkflowBudgetUsage } from './workflow.types'
import { WorkflowBudgetError } from './workflow.errors'

@Injectable()
export class WorkflowBudgetService {
  constructor(@Inject(AgentExecutionConfig.KEY) private readonly config: IAgentExecutionConfig) {}

  resolveLimits(workflow: FrozenWorkflowDefinition, rawBudget: unknown): WorkflowBudgetLimits {
    const budget = asRecord(rawBudget)
    return {
      maxSteps: Math.min(this.config.maxSteps, workflow.maxSteps, readInteger(budget.maxSteps, this.config.maxSteps)),
      maxToolCalls: Math.min(
        this.config.maxToolCalls,
        readInteger(budget.maxToolCalls, this.config.maxToolCalls, true),
      ),
      maxParallelTools: Math.min(
        this.config.maxParallelTools,
        workflow.maxParallelTools,
        readInteger(budget.maxParallelTools, this.config.maxParallelTools),
      ),
      maxInputTokens: Math.min(
        this.config.maxInputTokens,
        readInteger(budget.maxInputTokens, this.config.maxInputTokens),
      ),
      maxCost: Math.min(
        this.config.maxCostPerRun,
        readNumber(budget.maxCost ?? budget.maxCostPerRun, this.config.maxCostPerRun),
      ),
      costCurrency: readCurrency(budget.costCurrency),
    }
  }

  initialUsage(limits: WorkflowBudgetLimits): WorkflowBudgetUsage {
    return {
      steps: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      costCurrency: limits.costCurrency,
    }
  }

  assertCanStartStep(usage: WorkflowBudgetUsage, limits: WorkflowBudgetLimits): void {
    this.assertUsage(usage, limits)
    if (usage.steps >= limits.maxSteps) throw new WorkflowBudgetError('Agent 工作流步数已达上限')
  }

  assertCanPlanToolCalls(usage: WorkflowBudgetUsage, count: number, limits: WorkflowBudgetLimits): void {
    this.assertUsage(usage, limits)
    if (!Number.isInteger(count) || count < 0 || usage.toolCalls + count > limits.maxToolCalls) {
      throw new WorkflowBudgetError('Agent Tool 调用次数超过预算')
    }
  }

  assertCanCallModel(usage: WorkflowBudgetUsage, estimatedInputTokens: number, limits: WorkflowBudgetLimits): void {
    this.assertUsage(usage, limits)
    if (usage.inputTokens + Math.max(0, estimatedInputTokens) > limits.maxInputTokens) {
      throw new WorkflowBudgetError('Agent 模型输入 Token 超过预算', 6018)
    }
  }

  assertUsage(usage: WorkflowBudgetUsage, limits: WorkflowBudgetLimits): void {
    if (usage.steps > limits.maxSteps) throw new WorkflowBudgetError('Agent 工作流步数超过预算')
    if (usage.toolCalls > limits.maxToolCalls) throw new WorkflowBudgetError('Agent Tool 调用次数超过预算')
    if (usage.inputTokens > limits.maxInputTokens) {
      throw new WorkflowBudgetError('Agent 模型输入 Token 超过预算', 6018)
    }
    if (usage.costCurrency !== limits.costCurrency) throw new WorkflowBudgetError('Agent 成本预算币种不一致')
    if (usage.cost > limits.maxCost) throw new WorkflowBudgetError('Agent 成本额度不足')
  }

  estimateInputTokens(messages: readonly { content: string }[]): number {
    return Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 4)
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readInteger(value: unknown, fallback: number, allowZero = false): number {
  if (value == null) return fallback
  const minimum = allowZero ? 0 : 1
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new WorkflowBudgetError(`预算整数必须不小于 ${minimum}`)
  }
  return value as number
}

function readNumber(value: unknown, fallback: number): number {
  if (value == null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new WorkflowBudgetError('成本预算必须为非负有限数值')
  }
  return value
}

function readCurrency(value: unknown): string {
  if (value == null) return 'CNY'
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value.trim().toUpperCase())) {
    throw new WorkflowBudgetError('成本预算币种必须为 3 位代码')
  }
  return value.trim().toUpperCase()
}
