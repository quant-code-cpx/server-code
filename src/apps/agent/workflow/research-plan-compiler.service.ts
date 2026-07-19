import { Injectable } from '@nestjs/common'
import { AGENT_TOOL_KEYS, isAgentToolKey, type AgentCapability, type AgentToolKey } from '../contracts'
import type {
  CompiledResearchPlan,
  FrozenWorkflowDefinition,
  ResearchPlan,
  ResearchPlanToolCall,
} from './workflow.types'
import { WorkflowValidationError } from './workflow.errors'

const TOOL_CAPABILITY: Readonly<Record<AgentToolKey, AgentCapability>> = Object.freeze(
  Object.fromEntries(
    AGENT_TOOL_KEYS.map((key) => [
      key,
      key === 'search_web' || key === 'fetch_web_page'
        ? 'WEB_SEARCH'
        : key.startsWith('compute_')
          ? 'QUANT_COMPUTE'
          : 'INTERNAL_DATA',
    ]),
  ) as Record<AgentToolKey, AgentCapability>,
)

@Injectable()
export class ResearchPlanCompilerService {
  compile(
    plan: ResearchPlan,
    workflow: FrozenWorkflowDefinition,
    allowedCapabilities: readonly AgentCapability[],
    maxToolCalls: number,
  ): CompiledResearchPlan {
    assertPlanEnvelope(plan)
    if (plan.toolCalls.length > maxToolCalls) throw new WorkflowValidationError('研究计划 Tool 数量超过预算')
    const workflowTools = new Set(workflow.toolAllowlist)
    const capabilities = new Set(allowedCapabilities)
    const callsById = new Map<string, ResearchPlanToolCall>()

    for (const call of plan.toolCalls) {
      assertToolCall(call)
      if (callsById.has(call.id)) throw new WorkflowValidationError(`研究计划 Tool id 重复：${call.id}`)
      if (!workflowTools.has(call.toolKey))
        throw new WorkflowValidationError(`研究计划 Tool 不在工作流白名单：${call.toolKey}`)
      if (!capabilities.has(TOOL_CAPABILITY[call.toolKey])) {
        throw new WorkflowValidationError(`研究计划 Tool capability 未授权：${call.toolKey}`)
      }
      callsById.set(call.id, call)
    }

    for (const call of plan.toolCalls) {
      for (const dependency of call.dependsOn) {
        if (dependency === call.id) throw new WorkflowValidationError(`研究计划 Tool 不可依赖自身：${call.id}`)
        if (!callsById.has(dependency)) throw new WorkflowValidationError(`研究计划依赖不存在：${dependency}`)
      }
    }

    const executionLevels = topologicalLevels(plan.toolCalls)
    const toolPins = [...new Map(plan.toolCalls.map((call) => [`${call.toolKey}@${call.toolVersion}`, call])).values()]
      .map((call) => ({ key: call.toolKey, version: call.toolVersion }))
      .sort((left, right) => left.key.localeCompare(right.key) || left.version - right.version)
    return {
      intent: plan.intent.trim(),
      summary: plan.summary.trim(),
      toolCalls: plan.toolCalls.map((call) => ({
        ...call,
        input: { ...call.input },
        dependsOn: [...call.dependsOn],
      })),
      executionLevels,
      toolPins,
    }
  }
}

function topologicalLevels(calls: ResearchPlanToolCall[]): string[][] {
  const remaining = new Map(calls.map((call) => [call.id, new Set(call.dependsOn)]))
  const levels: string[][] = []
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([id]) => id)
      .sort((left, right) => calls.findIndex((call) => call.id === left) - calls.findIndex((call) => call.id === right))
    if (ready.length === 0) throw new WorkflowValidationError('研究计划 Tool 依赖存在环')
    levels.push(ready)
    for (const id of ready) remaining.delete(id)
    for (const dependencies of remaining.values()) for (const id of ready) dependencies.delete(id)
  }
  return levels
}

function assertPlanEnvelope(plan: ResearchPlan): void {
  if (!plan || typeof plan !== 'object') throw new WorkflowValidationError('研究计划必须为 object')
  if (typeof plan.intent !== 'string' || !plan.intent.trim())
    throw new WorkflowValidationError('研究计划 intent 不能为空')
  if (typeof plan.summary !== 'string' || !plan.summary.trim()) {
    throw new WorkflowValidationError('研究计划 summary 不能为空')
  }
  if (!Array.isArray(plan.toolCalls)) throw new WorkflowValidationError('研究计划 toolCalls 必须为数组')
}

function assertToolCall(call: ResearchPlanToolCall): void {
  if (!call || typeof call !== 'object') throw new WorkflowValidationError('研究计划 Tool 调用非法')
  if (typeof call.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(call.id)) {
    throw new WorkflowValidationError('研究计划 Tool id 非法')
  }
  if (!isAgentToolKey(call.toolKey)) throw new WorkflowValidationError(`研究计划包含未知 Tool：${String(call.toolKey)}`)
  if (call.toolVersion !== 1) throw new WorkflowValidationError('MVP Tool version 必须为 1')
  if (!call.input || typeof call.input !== 'object' || Array.isArray(call.input)) {
    throw new WorkflowValidationError('研究计划 Tool input 必须为 object')
  }
  if (!Array.isArray(call.dependsOn) || call.dependsOn.some((value) => typeof value !== 'string')) {
    throw new WorkflowValidationError('研究计划 Tool dependsOn 非法')
  }
  if (typeof call.optional !== 'boolean') throw new WorkflowValidationError('研究计划 Tool optional 非法')
}
