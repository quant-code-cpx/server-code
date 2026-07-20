import { AiAgentRunStatus, AiAgentStepStatus } from '@prisma/client'
import { buildAgentExecutionConfig } from 'src/config/agent-execution.config'
import { AgentExecutionValidationError, AgentRunConflictError } from '../agent-execution.errors'
import { sanitizeEventPayload, sanitizeExecutionObject } from '../agent-execution.payload'
import { AgentStateMachineService } from '../agent-state-machine.service'

describe('AgentStateMachineService', () => {
  const service = new AgentStateMachineService()

  it('Run 合法转换集合与 canonical 公共状态模型完全一致', () => {
    const expected = new Set([
      'QUEUED->RUNNING',
      'QUEUED->CANCELLED',
      'RUNNING->CANCEL_REQUESTED',
      'RUNNING->COMPLETED',
      'RUNNING->FAILED',
      'CANCEL_REQUESTED->CANCELLED',
    ])

    for (const current of Object.values(AiAgentRunStatus)) {
      for (const target of Object.values(AiAgentRunStatus)) {
        const key = `${current}->${target}`
        if (expected.has(key)) expect(() => service.assertRunTransition(current, target)).not.toThrow()
        else expect(() => service.assertRunTransition(current, target)).toThrow(AgentRunConflictError)
      }
    }
  })

  it('COMPLETED/FAILED/CANCELLED 是 Run 终态，基础设施恢复不开放 RUNNING->QUEUED', () => {
    expect(service.isTerminalRunStatus(AiAgentRunStatus.COMPLETED)).toBe(true)
    expect(service.isTerminalRunStatus(AiAgentRunStatus.FAILED)).toBe(true)
    expect(service.isTerminalRunStatus(AiAgentRunStatus.CANCELLED)).toBe(true)
    expect(service.isTerminalRunStatus(AiAgentRunStatus.CANCEL_REQUESTED)).toBe(false)
    expect(() => service.assertRunTransition(AiAgentRunStatus.RUNNING, AiAgentRunStatus.QUEUED)).toThrow(
      AgentRunConflictError,
    )
  })

  it('Step 只允许 pending 开始/跳过/取消，以及 running 完成/失败/取消', () => {
    const expected = new Set([
      'PENDING->RUNNING',
      'PENDING->CANCELLED',
      'PENDING->SKIPPED',
      'RUNNING->COMPLETED',
      'RUNNING->FAILED',
      'RUNNING->CANCELLED',
    ])

    for (const current of Object.values(AiAgentStepStatus)) {
      for (const target of Object.values(AiAgentStepStatus)) {
        const action = () => service.assertStepTransition(current, target)
        if (expected.has(`${current}->${target}`)) expect(action).not.toThrow()
        else expect(action).toThrow(AgentRunConflictError)
      }
    }
  })
})

describe('Agent execution 配置与 payload 边界', () => {
  it('配置采用受控默认值，并拒绝越界或非整数', () => {
    expect(buildAgentExecutionConfig({})).toEqual({
      leaseMs: 30_000,
      leaseHeartbeatMs: 10_000,
      replayLimit: 100,
      maxDurationMs: 180_000,
      maxSteps: 32,
      maxToolCalls: 20,
      maxParallelTools: 3,
      maxInputTokens: 32_768,
      maxCostPerRun: 10,
    })
    expect(() => buildAgentExecutionConfig({ AGENT_RUN_LEASE_MS: '999' })).toThrow('AGENT_RUN_LEASE_MS')
    expect(() => buildAgentExecutionConfig({ AGENT_RUN_LEASE_MS: '1000', AGENT_LEASE_HEARTBEAT_MS: '1000' })).toThrow(
      'AGENT_LEASE_HEARTBEAT_MS',
    )
    expect(() => buildAgentExecutionConfig({ AGENT_EVENT_REPLAY_LIMIT: '1001' })).toThrow('AGENT_EVENT_REPLAY_LIMIT')
    expect(() => buildAgentExecutionConfig({ AGENT_RUN_MAX_DURATION_MS: 'NaN' })).toThrow('AGENT_RUN_MAX_DURATION_MS')
    expect(() => buildAgentExecutionConfig({ AGENT_MAX_STEPS: '7' })).toThrow('AGENT_MAX_STEPS')
    expect(() => buildAgentExecutionConfig({ AGENT_MAX_TOOL_CALLS: '-1' })).toThrow('AGENT_MAX_TOOL_CALLS')
    expect(() => buildAgentExecutionConfig({ AGENT_MAX_PARALLEL_TOOLS: '0' })).toThrow('AGENT_MAX_PARALLEL_TOOLS')
    expect(() => buildAgentExecutionConfig({ AGENT_MAX_INPUT_TOKENS: '0' })).toThrow('AGENT_MAX_INPUT_TOKENS')
    expect(() => buildAgentExecutionConfig({ AGENT_MAX_COST_PER_RUN: 'Infinity' })).toThrow('AGENT_MAX_COST_PER_RUN')
  })

  it('checkpoint/event payload 递归脱敏 secret 与 hidden reasoning，并移除顶层保留字段 schemaVersion', () => {
    const checkpoint = sanitizeExecutionObject(
      {
        node: 'verify',
        authorization: 'Bearer private-token',
        hiddenReasoning: 'private chain of thought',
        refIds: ['tool_1'],
      },
      'checkpoint',
    )
    const event = sanitizeEventPayload({
      schemaVersion: '9.9',
      apiKey: 'private-key',
      accessToken: 'private-token',
      inputTokens: 12,
      outputTokens: 3,
      result: { refId: 'citation_1' },
    })
    const snapshot = JSON.stringify({ checkpoint, event })

    expect(snapshot).not.toContain('private-token')
    expect(snapshot).not.toContain('private chain of thought')
    expect(snapshot).not.toContain('private-key')
    expect(event.schemaVersion).toBeUndefined()
    expect(event.inputTokens).toBe(12)
    expect(event.outputTokens).toBe(3)
    expect(event.accessToken).toBe('[REDACTED]')
  })

  it('非 object 或脱敏后仍超过 256KB 的 payload 在写库前拒绝', () => {
    expect(() => sanitizeExecutionObject(['not-object'], 'checkpoint')).toThrow(AgentExecutionValidationError)
    const oversized = Object.fromEntries(
      Array.from({ length: 140 }, (_, index) => [`field_${index}`, 'x'.repeat(2_000)]),
    )
    expect(() => sanitizeEventPayload(oversized)).toThrow('超过 256000 bytes')
  })
})
