import { resolveAgentRunExecutionBudget } from '../agent-interaction.repository'

describe('Agent Run execution budget', () => {
  it('按模型单次超时、重试、结构化修复与工作流模型调用上限计算 deadline', () => {
    expect(
      resolveAgentRunExecutionBudget({
        configs: [{ timeoutMs: 120_000, maxRetries: 2, retryBaseMs: 200 }],
        maxModelCalls: 4,
        fallbackDurationMs: 180_000,
        nonModelReserveMs: 60_000,
        maxDurationMs: 10_800_000,
      }),
    ).toEqual({
      durationMs: 2_946_000,
      requestedDurationMs: 2_946_000,
      maxDurationMs: 10_800_000,
      maxModelCalls: 4,
      perModelCallBudgetMs: 721_500,
      providerConfigCount: 1,
      clippedBySystemMaximum: false,
    })
  })

  it('AUTO 采用活动候选中最大的模型预算，缺失配置时使用兜底时长', () => {
    expect(
      resolveAgentRunExecutionBudget({
        configs: [
          { timeoutMs: 30_000, maxRetries: 0, retryBaseMs: 0 },
          { timeoutMs: 60_000, maxRetries: 0, retryBaseMs: 0 },
        ],
        maxModelCalls: 4,
        fallbackDurationMs: 180_000,
        nonModelReserveMs: 60_000,
        maxDurationMs: 10_800_000,
      }).durationMs,
    ).toBe(540_000)
    expect(
      resolveAgentRunExecutionBudget({
        configs: [],
        maxModelCalls: 4,
        fallbackDurationMs: 180_000,
        nonModelReserveMs: 60_000,
        maxDurationMs: 10_800_000,
      }).durationMs,
    ).toBe(180_000)
  })

  it('模型预算超过系统安全上限时明确记录裁剪', () => {
    expect(
      resolveAgentRunExecutionBudget({
        configs: [{ timeoutMs: 300_000, maxRetries: 2, retryBaseMs: 10_000 }],
        maxModelCalls: 32,
        fallbackDurationMs: 180_000,
        nonModelReserveMs: 60_000,
        maxDurationMs: 10_800_000,
      }),
    ).toMatchObject({ durationMs: 10_800_000, clippedBySystemMaximum: true })
  })
})
