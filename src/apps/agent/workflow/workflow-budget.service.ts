import { Inject, Injectable } from '@nestjs/common'
import { AgentExecutionConfig, type IAgentExecutionConfig } from 'src/config/agent-execution.config'
import type { FrozenWorkflowDefinition, WorkflowBudgetLimits, WorkflowBudgetUsage } from './workflow.types'
import { WorkflowBudgetError } from './workflow.errors'

@Injectable()
export class WorkflowBudgetService {
  constructor(@Inject(AgentExecutionConfig.KEY) private readonly config: IAgentExecutionConfig) {}

  resolveLimits(workflow: FrozenWorkflowDefinition, rawBudget: unknown): WorkflowBudgetLimits {
    const budget = asRecord(rawBudget)
    const runPolicy = asRecord(budget.runPolicy)
    if (runPolicy.schemaVersion === 1) {
      return {
        maxSteps: Math.min(workflow.maxSteps, readInteger(runPolicy.maxSteps, workflow.maxSteps)),
        maxToolCalls: readInteger(runPolicy.maxToolCalls, this.config.maxToolCalls, true),
        maxParallelTools: Math.min(
          workflow.maxParallelTools,
          readInteger(runPolicy.maxParallelTools, workflow.maxParallelTools),
        ),
        maxCumulativeInputTokens: readNullablePositiveInteger(runPolicy.maxCumulativeInputTokens),
        inputTokenGuardrailSource: 'RUN_SNAPSHOT',
        maxCost: readNumber(runPolicy.maxCost, this.config.maxCostPerRun),
        costCurrency: readCurrency(runPolicy.costCurrency),
      }
    }
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
      maxCumulativeInputTokens: readLegacyCumulativeInputLimit(budget, this.config.maxCumulativeInputTokens),
      inputTokenGuardrailSource: budget.maxInputTokens == null ? this.config.inputTokenGuardrailSource : 'LEGACY_RUN',
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
    if (usage.cost >= limits.maxCost) {
      throw new WorkflowBudgetError('Agent Run 成本护栏已耗尽，已在模型调用前停止')
    }
    if (
      limits.maxCumulativeInputTokens != null &&
      usage.inputTokens + Math.max(0, estimatedInputTokens) > limits.maxCumulativeInputTokens
    ) {
      throw new WorkflowBudgetError('Agent Run 累计输入 Token 成本护栏将在本次调用前超限', 6018)
    }
  }

  assertUsage(usage: WorkflowBudgetUsage, limits: WorkflowBudgetLimits): void {
    if (usage.steps > limits.maxSteps) throw new WorkflowBudgetError('Agent 工作流步数超过预算')
    if (usage.toolCalls > limits.maxToolCalls) throw new WorkflowBudgetError('Agent Tool 调用次数超过预算')
    if (usage.costCurrency !== limits.costCurrency) throw new WorkflowBudgetError('Agent 成本预算币种不一致')
    // 模型成功后只记账，不把真实 usage 的事后轻微越界伪装成模型失败。
    // 下一次模型调用会由 assertCanCallModel 在发请求前停止。
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

function readNullablePositiveInteger(value: unknown): number | null {
  if (value == null) return null
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new WorkflowBudgetError('Run 累计输入 Token 护栏必须为正整数或 null')
  }
  return value as number
}

function readLegacyCumulativeInputLimit(budget: Record<string, unknown>, configured: number | null): number | null {
  const legacy = readNullablePositiveInteger(budget.maxInputTokens)
  if (legacy == null) return configured
  return configured == null ? legacy : Math.min(legacy, configured)
}

function readCurrency(value: unknown): string {
  if (value == null) return 'CNY'
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value.trim().toUpperCase())) {
    throw new WorkflowBudgetError('成本预算币种必须为 3 位代码')
  }
  return value.trim().toUpperCase()
}
