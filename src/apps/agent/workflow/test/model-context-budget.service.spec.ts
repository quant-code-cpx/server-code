import { Test } from '@nestjs/testing'
import { buildAgentContextConfig, AgentContextConfig } from 'src/config/agent-context.config'
import { sanitizeExecutionObject } from '../../execution/agent-execution.payload'
import { ModelContextBudgetService } from '../model-context-budget.service'
import type { WorkflowModelProfile } from '../workflow.types'

describe('ModelContextBudgetService', () => {
  let service: ModelContextBudgetService

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelContextBudgetService,
        { provide: AgentContextConfig.KEY, useValue: buildAgentContextConfig({}) },
      ],
    }).compile()
    service = moduleRef.get(ModelContextBudgetService)
  })

  it('同一配置下，小上下文模型自动获得更小输入、触发线和压缩目标', () => {
    const small = service.resolve(profile(4_096, 2_048), usage(), limits())
    const large = service.resolve(profile(32_768, 8_192), usage(), limits())

    expect(small.inputBudget).toBeLessThan(large.inputBudget)
    expect(small.compactionTriggerTokens).toBeLessThan(large.compactionTriggerTokens)
    expect(small.compactionTargetTokens).toBeLessThan(small.compactionTriggerTokens)
    expect(large.maxOutputTokens).toBeGreaterThan(small.maxOutputTokens)
  })

  it('AUTO fallback 按候选中最小窗口规划，避免主模型失败后把过大上下文交给小模型', () => {
    const mixed = profile(32_768, 8_192)
    mixed.candidates.push(profile(4_096, 1_024).candidates[0])

    const plan = service.resolve(mixed, usage(), limits())

    expect(plan.contextWindow).toBe(4_096)
    expect(plan.maxOutputTokens).toBeLessThanOrEqual(1_024)
    expect(plan.inputBudget + plan.maxOutputTokens).toBeLessThanOrEqual(plan.safeContextWindow)
  })

  it('[REG][6018] 128K 模型能力不再被已移除的静态 32K 输入上限覆盖', () => {
    const plan = service.resolve(profile(128_000, 128_000), usage(), limitsWithoutInputGuardrail())

    expect(plan.contextWindow).toBe(128_000)
    expect(plan.inputBudget).toBeGreaterThan(32_768)
    expect(plan.inputBudget + plan.maxOutputTokens).toBeLessThanOrEqual(plan.safeContextWindow)
  })

  it('Run 已消耗输入预算时动态收缩剩余额度；无空间时返回 6048', () => {
    const remaining = service.resolve(profile(32_768, 8_192), usage(31_000), limits())
    expect(remaining.inputBudget).toBe(1_768)

    expect(() => service.resolve(profile(4_096, 2_048), usage(32_768), limits())).toThrow(
      expect.objectContaining({ agentCode: 6048 }),
    )
  })

  it('恢复到空候选或非法模型能力的旧 Checkpoint 时返回 6048', () => {
    const empty = profile(4_096, 1_024)
    empty.candidates = []
    expect(() => service.resolve(empty, usage(), limits())).toThrow(expect.objectContaining({ agentCode: 6048 }))

    const invalid = profile(4_096, 1_024)
    invalid.candidates[0].contextWindow = 0
    expect(() => service.resolve(invalid, usage(), limits())).toThrow(expect.objectContaining({ agentCode: 6048 }))
  })

  it('[REG][RECOVERY] 模型能力经过 Checkpoint 持久化往返后仍可用于预算计算', () => {
    const original = profile(1_000_000, 32_768)
    const checkpoint = sanitizeExecutionObject({ state: { modelProfile: original } }, 'checkpoint')
    const recovered = JSON.parse(JSON.stringify(checkpoint)).state.modelProfile as WorkflowModelProfile

    expect(recovered.candidates[0]).toMatchObject({
      contextWindow: 1_000_000,
      maxOutputTokens: 32_768,
    })
    expect(service.resolve(recovered, usage(6_397), limits())).toMatchObject({
      contextWindow: 1_000_000,
    })
  })

  it('[REG] 大上下文模型的输出额度按安全上下文预留，不被 Run 输入预算错误压缩', () => {
    const plan = service.resolve(profile(1_000_000, 384_000), usage(), limits())

    expect(plan.maxOutputTokens).toBe(138_000)
    expect(plan.maxOutputTokens).toBeGreaterThan(limits().maxCumulativeInputTokens!)
    expect(plan.inputBudget).toBe(limits().maxCumulativeInputTokens)
  })
})

function profile(contextWindow: number, maxOutputTokens: number): WorkflowModelProfile {
  return {
    selectedProvider: 'fake',
    selectedModel: `model-${contextWindow}`,
    candidates: [
      {
        provider: 'fake',
        model: `model-${contextWindow}`,
        contextWindow,
        maxOutputTokens,
        capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
        reasoningEfforts: [],
        dataClasses: ['USER_PRIVATE'],
      },
    ],
  }
}

function usage(inputTokens = 0) {
  return { steps: 0, toolCalls: 0, inputTokens, outputTokens: 0, cost: 0, costCurrency: 'CNY' }
}

function limits() {
  return {
    maxSteps: 8,
    maxToolCalls: 10,
    maxParallelTools: 3,
    maxCumulativeInputTokens: 32_768,
    inputTokenGuardrailSource: 'RUN_SNAPSHOT' as const,
    maxCost: 10,
    costCurrency: 'CNY',
  }
}

function limitsWithoutInputGuardrail() {
  return {
    ...limits(),
    maxCumulativeInputTokens: null,
    inputTokenGuardrailSource: 'DISABLED_BY_DEFAULT' as const,
  }
}
