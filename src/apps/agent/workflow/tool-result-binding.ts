import type { ToolResult } from '../tools/contracts/tool-result'
import { WorkflowValidationError } from './workflow.errors'

const MAX_BINDING_PATH_LENGTH = 16
const MAX_INPUT_DEPTH = 32
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

interface ToolResultBinding {
  callId: string
  path: Array<string | number>
}

export class ToolResultBindingUnavailableError extends WorkflowValidationError {
  constructor(
    readonly dependencyCallId: string,
    message: string,
  ) {
    super(message)
    this.name = ToolResultBindingUnavailableError.name
  }
}

export function cloneAndValidateToolInput(
  input: Record<string, unknown>,
  directDependencies: readonly string[],
): Record<string, unknown> {
  return transformValue(input, directDependencies, null, 0) as Record<string, unknown>
}

export function resolveToolInputBindings(
  input: Record<string, unknown>,
  directDependencies: readonly string[],
  resultsByCallId: ReadonlyMap<string, ToolResult>,
): Record<string, unknown> {
  return transformValue(input, directDependencies, resultsByCallId, 0) as Record<string, unknown>
}

function transformValue(
  value: unknown,
  directDependencies: readonly string[],
  resultsByCallId: ReadonlyMap<string, ToolResult> | null,
  depth: number,
): unknown {
  if (depth > MAX_INPUT_DEPTH) throw new WorkflowValidationError('研究计划 Tool input 嵌套过深')
  if (Array.isArray(value)) {
    return value.map((item) => transformValue(item, directDependencies, resultsByCallId, depth + 1))
  }
  if (!isRecord(value)) return value

  const binding = parseBinding(value, directDependencies)
  if (binding) {
    if (!resultsByCallId) return cloneBinding(binding)
    return resolveBinding(binding, resultsByCallId)
  }

  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (BLOCKED_KEYS.has(key)) throw new WorkflowValidationError(`研究计划 Tool input key 非法：${key}`)
    output[key] = transformValue(entry, directDependencies, resultsByCallId, depth + 1)
  }
  return output
}

function parseBinding(value: Record<string, unknown>, directDependencies: readonly string[]): ToolResultBinding | null {
  if (!Object.prototype.hasOwnProperty.call(value, '$toolResult')) return null
  if (Object.keys(value).length !== 1) throw new WorkflowValidationError('Tool 结果绑定对象只能包含 $toolResult')
  const raw = value.$toolResult
  const rawKeys = isRecord(raw) ? Object.keys(raw).sort() : []
  if (!isRecord(raw) || rawKeys.length !== 2 || rawKeys[0] !== 'callId' || rawKeys[1] !== 'path') {
    throw new WorkflowValidationError('Tool 结果绑定必须包含 callId 与 path')
  }
  if (typeof raw.callId !== 'string' || !directDependencies.includes(raw.callId)) {
    throw new WorkflowValidationError('Tool 结果绑定 callId 必须是当前调用的直接依赖')
  }
  if (
    !Array.isArray(raw.path) ||
    raw.path.length === 0 ||
    raw.path.length > MAX_BINDING_PATH_LENGTH ||
    raw.path.some((segment) => !isSafePathSegment(segment))
  ) {
    throw new WorkflowValidationError('Tool 结果绑定 path 非法')
  }
  return { callId: raw.callId, path: [...raw.path] as Array<string | number> }
}

function resolveBinding(binding: ToolResultBinding, resultsByCallId: ReadonlyMap<string, ToolResult>): unknown {
  const result = resultsByCallId.get(binding.callId)
  if (!result) {
    throw new ToolResultBindingUnavailableError(binding.callId, `依赖 Tool ${binding.callId} 无可用结果`)
  }
  let current: unknown = result.data
  for (const [index, rawSegment] of binding.path.entries()) {
    const segment = resolveLegacyResultCollectionAlias(current, rawSegment, index)
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
        throw missingPath(binding)
      }
      current = current[segment]
      continue
    }
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) throw missingPath(binding)
    current = current[segment]
  }
  if (current === undefined) throw missingPath(binding)
  return current
}

function resolveLegacyResultCollectionAlias(current: unknown, segment: string | number, index: number): string | number {
  if (
    index === 0 &&
    segment === 'results' &&
    isRecord(current) &&
    !Object.prototype.hasOwnProperty.call(current, 'results') &&
    Array.isArray(current.candidates)
  ) {
    return 'candidates'
  }
  return segment
}

function missingPath(binding: ToolResultBinding): ToolResultBindingUnavailableError {
  return new ToolResultBindingUnavailableError(
    binding.callId,
    `依赖 Tool ${binding.callId} 结果路径不存在：${binding.path.join('.')}`,
  )
}

function cloneBinding(binding: ToolResultBinding): Record<string, unknown> {
  return { $toolResult: { callId: binding.callId, path: [...binding.path] } }
}

function isSafePathSegment(value: unknown): value is string | number {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value) && !BLOCKED_KEYS.has(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
