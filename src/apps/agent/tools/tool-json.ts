import { createHash } from 'node:crypto'

export class ToolJsonValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = ToolJsonValidationError.name
  }
}

export function stableJson(value: unknown, maxDepth = 32): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(normalize(value, 0, maxDepth, seen))
}

export function hashStableJson(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex')
}

export function cloneAndFreezeJson<T>(value: T): T {
  return deepFreeze(JSON.parse(stableJson(value)) as T)
}

function normalize(value: unknown, depth: number, maxDepth: number, seen: WeakSet<object>): unknown {
  if (depth > maxDepth) throw new ToolJsonValidationError(`JSON 嵌套深度超过 ${maxDepth}`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ToolJsonValidationError('JSON number 必须为有限数')
    return value
  }
  if (typeof value === 'bigint') throw new ToolJsonValidationError('JSON 不支持 BigInt')
  if (typeof value !== 'object') throw new ToolJsonValidationError(`JSON 不支持 ${typeof value}`)
  if (value instanceof Date) throw new ToolJsonValidationError('JSON 日期必须使用 ISO string')
  if (seen.has(value)) throw new ToolJsonValidationError('JSON 不支持循环引用')
  if (Object.getOwnPropertySymbols(value).length > 0) throw new ToolJsonValidationError('JSON 不支持 symbol key')
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new ToolJsonValidationError('JSON 只支持 plain object')
  }

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const extraKeys = Object.keys(value).filter((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
      if (extraKeys.length > 0) throw new ToolJsonValidationError('JSON array 不支持自定义属性')
      return Array.from(value, (item) => normalize(item, depth + 1, maxDepth, seen))
    }
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      output[key] = normalize((value as Record<string, unknown>)[key], depth + 1, maxDepth, seen)
    }
    return output
  } finally {
    seen.delete(value)
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
