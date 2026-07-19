import { Injectable } from '@nestjs/common'
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import type { JsonSchema } from '../contracts'
import type { ToolDefinition } from './contracts/tool-definition'
import { stableJson, ToolJsonValidationError } from './tool-json'

export interface ToolSchemaValidationResult {
  valid: boolean
  issues: string[]
}

const MAX_TOOL_INPUT_BYTES = 128_000

@Injectable()
export class ToolSchemaValidator {
  private readonly ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true, validateFormats: true })
  private readonly validators = new Map<string, ValidateFunction>()

  constructor() {
    this.ajv.addFormat('date', { type: 'string', validate: isIsoDate })
    this.ajv.addFormat('date-time', { type: 'string', validate: isIsoDateTime })
  }

  assertDefinitionSchemas(definition: ToolDefinition): void {
    assertStrictInputRoot(definition.inputSchema)
    assertClosedObjects(definition.inputSchema)
    assertClosedObjects(definition.outputSchema)
    this.compile(definition.inputSchema, this.schemaKey(definition, 'input'))
    this.compile(definition.outputSchema, this.schemaKey(definition, 'output'))
  }

  validateInput(definition: ToolDefinition, input: unknown): ToolSchemaValidationResult {
    const jsonIssue = validateJson(input, MAX_TOOL_INPUT_BYTES)
    if (jsonIssue) return { valid: false, issues: [jsonIssue] }
    return this.validate(this.schemaKey(definition, 'input'), definition.inputSchema, input)
  }

  validateOutput(definition: ToolDefinition, output: unknown): ToolSchemaValidationResult {
    const jsonIssue = validateJson(output)
    if (jsonIssue) return { valid: false, issues: [jsonIssue] }
    return this.validate(this.schemaKey(definition, 'output'), definition.outputSchema, output)
  }

  private validate(key: string, schema: JsonSchema, value: unknown): ToolSchemaValidationResult {
    const validator = this.compile(schema, key)
    if (validator(value)) return { valid: true, issues: [] }
    return { valid: false, issues: safeIssues(validator.errors) }
  }

  private compile(schema: JsonSchema, key: string): ValidateFunction {
    const cached = this.validators.get(key)
    if (cached) return cached
    let validator: ValidateFunction
    try {
      validator = this.ajv.compile(schema)
    } catch (error) {
      throw new Error(`Tool JSON Schema 无法编译：${error instanceof Error ? error.message : 'unknown error'}`)
    }
    this.validators.set(key, validator)
    return validator
  }

  private schemaKey(definition: ToolDefinition, kind: 'input' | 'output'): string {
    return `${definition.key}@${definition.version}:${kind}`
  }
}

function assertStrictInputRoot(schema: JsonSchema): void {
  if (schema.type !== 'object') throw new Error('Tool inputSchema 根节点必须是 object')
  if (schema.additionalProperties !== false) {
    throw new Error('Tool inputSchema 根节点必须 additionalProperties=false')
  }
}

function assertClosedObjects(schema: unknown, path = '#', seen = new WeakSet<object>()): void {
  if (!schema || typeof schema !== 'object' || seen.has(schema)) return
  seen.add(schema)
  const record = schema as Record<string, unknown>
  const types = Array.isArray(record.type) ? record.type : [record.type]
  if (types.includes('object') && record.additionalProperties !== false) {
    throw new Error(`Tool JSON Schema object 必须 additionalProperties=false：${path}`)
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'default' || key === 'enum' || key === 'const') continue
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertClosedObjects(item, `${path}/${key}/${index}`, seen))
    } else {
      assertClosedObjects(value, `${path}/${key}`, seen)
    }
  }
}

function validateJson(value: unknown, maxBytes?: number): string | null {
  try {
    const serialized = stableJson(value)
    if (maxBytes != null && Buffer.byteLength(serialized, 'utf8') > maxBytes) {
      return `JSON 超过 ${maxBytes} bytes`
    }
    return null
  } catch (error) {
    return error instanceof ToolJsonValidationError ? error.message : 'JSON 无法序列化'
  }
}

function safeIssues(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors?.length) return ['schema validation failed']
  return errors.slice(0, 8).map((error) => `${error.instancePath || '/'} ${error.keyword}`)
}

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function isIsoDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return false
  const [, year, month, day, hour, minute, second] = match
  if (!isIsoDate(`${year}-${month}-${day}`)) return false
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false
  return !Number.isNaN(Date.parse(value))
}
