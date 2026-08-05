import { Inject, Injectable } from '@nestjs/common'
import { AgentContextConfig, type IAgentContextConfig } from 'src/config/agent-context.config'
import { WorkflowBudgetError } from './workflow.errors'
import type { WorkflowBudgetLimits, WorkflowBudgetUsage, WorkflowModelProfile } from './workflow.types'

export interface ModelContextBudgetPlan {
  contextWindow: number
  safeContextWindow: number
  maxOutputTokens: number
  inputBudget: number
  compactionTriggerTokens: number
  compactionTargetTokens: number
  summaryInputBudget: number
  summaryOutputTokens: number
}

@Injectable()
export class ModelContextBudgetService {
  constructor(@Inject(AgentContextConfig.KEY) private readonly config: IAgentContextConfig) {}

  resolve(
    profile: WorkflowModelProfile,
    usage: WorkflowBudgetUsage,
    limits: WorkflowBudgetLimits,
  ): ModelContextBudgetPlan {
    if (
      profile.candidates.length === 0 ||
      profile.candidates.some(
        (candidate) =>
          !Number.isInteger(candidate.contextWindow) ||
          candidate.contextWindow < 1 ||
          !Number.isInteger(candidate.maxOutputTokens) ||
          candidate.maxOutputTokens < 1,
      )
    ) {
      throw new WorkflowBudgetError('目标模型上下文能力配置无效，请重新选择模型', 6048)
    }
    const contextWindow = Math.min(...profile.candidates.map((candidate) => candidate.contextWindow))
    const modelOutputLimit = Math.min(...profile.candidates.map((candidate) => candidate.maxOutputTokens))
    const safeContextWindow = Math.floor(contextWindow * (1 - this.config.safetyRatio))
    const reserveBase = Math.min(contextWindow, limits.maxInputTokens)
    const maxOutputTokens = Math.max(
      1,
      Math.min(modelOutputLimit, Math.floor(reserveBase * this.config.outputReserveRatio)),
    )
    const remainingRunInput = limits.maxInputTokens - usage.inputTokens
    const inputBudget = Math.min(remainingRunInput, safeContextWindow - maxOutputTokens)
    if (!Number.isInteger(inputBudget) || inputBudget < 1) {
      throw new WorkflowBudgetError('目标模型没有足够的上下文空间，请选择上下文更大的模型', 6048)
    }

    const summaryOutputTokens = Math.max(
      1,
      Math.min(modelOutputLimit, Math.floor(reserveBase * this.config.summaryOutputReserveRatio)),
    )
    const summaryInputBudget = Math.min(
      safeContextWindow - summaryOutputTokens,
      Math.floor(remainingRunInput * this.config.summaryRunInputRatio),
    )

    return {
      contextWindow,
      safeContextWindow,
      maxOutputTokens,
      inputBudget,
      compactionTriggerTokens: Math.max(1, Math.floor(inputBudget * this.config.compactionTriggerRatio)),
      compactionTargetTokens: Math.max(1, Math.floor(inputBudget * this.config.compactionTargetRatio)),
      summaryInputBudget: Math.max(1, summaryInputBudget),
      summaryOutputTokens,
    }
  }
}
