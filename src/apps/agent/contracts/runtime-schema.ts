export type JsonSchema = Record<string, unknown>

export class AgentProtocolError extends Error {
  readonly code = 'AGENT_PROTOCOL_ERROR'

  constructor(readonly issues: string[]) {
    super(`Agent 协议校验失败: ${issues.join('; ')}`)
    this.name = AgentProtocolError.name
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case 'null':
      return value === null
    case 'object':
      return isRecord(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    default:
      return false
  }
}

function validateFormat(format: unknown, value: string): boolean {
  if (format === 'date') {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  }
  if (format === 'date-time') {
    return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))
  }
  return true
}

function validateNode(schema: JsonSchema, value: unknown, path: string, issues: string[]): void {
  if (Array.isArray(schema['oneOf'])) {
    const matched = schema['oneOf'].filter((candidate) => {
      const candidateIssues: string[] = []
      validateNode(candidate as JsonSchema, value, path, candidateIssues)
      return candidateIssues.length === 0
    })
    if (matched.length !== 1) issues.push(`${path} 必须且只能匹配一个 schema`)
    return
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema['const']) {
    issues.push(`${path} 必须等于 ${String(schema['const'])}`)
    return
  }

  if (Array.isArray(schema['enum']) && !schema['enum'].includes(value)) {
    issues.push(`${path} 不在允许枚举中`)
    return
  }

  const schemaType = schema['type']
  if (schemaType) {
    const allowedTypes = Array.isArray(schemaType) ? schemaType : [schemaType]
    if (!allowedTypes.some((type) => matchesType(String(type), value))) {
      issues.push(`${path} 类型不合法`)
      return
    }
  }

  if (typeof value === 'string') {
    if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) {
      issues.push(`${path} 长度小于 ${schema['minLength']}`)
    }
    if (typeof schema['maxLength'] === 'number' && value.length > schema['maxLength']) {
      issues.push(`${path} 长度超过 ${schema['maxLength']}`)
    }
    if (typeof schema['pattern'] === 'string' && !new RegExp(schema['pattern']).test(value)) {
      issues.push(`${path} 格式不匹配`)
    }
    if (!validateFormat(schema['format'], value)) issues.push(`${path} 日期格式不合法`)
  }

  if (typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) {
      issues.push(`${path} 小于最小值 ${schema['minimum']}`)
    }
    if (typeof schema['maximum'] === 'number' && value > schema['maximum']) {
      issues.push(`${path} 超过最大值 ${schema['maximum']}`)
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema['minItems'] === 'number' && value.length < schema['minItems']) {
      issues.push(`${path} 数组元素不足`)
    }
    if (typeof schema['maxItems'] === 'number' && value.length > schema['maxItems']) {
      issues.push(`${path} 数组元素过多`)
    }
    if (isRecord(schema['items'])) {
      value.forEach((item, index) => validateNode(schema['items'] as JsonSchema, item, `${path}[${index}]`, issues))
    }
  }

  if (isRecord(value)) {
    const properties = isRecord(schema['properties']) ? schema['properties'] : {}
    const required = Array.isArray(schema['required']) ? schema['required'].map(String) : []
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) issues.push(`${path}.${key} 缺失`)
    }
    for (const [key, propertyValue] of Object.entries(value)) {
      const propertySchema = properties[key]
      if (isRecord(propertySchema)) {
        validateNode(propertySchema, propertyValue, `${path}.${key}`, issues)
      } else if (schema['additionalProperties'] === false) {
        issues.push(`${path}.${key} 不允许出现`)
      }
    }
  }
}

export function assertJsonSchema<T>(schema: JsonSchema, value: unknown, label: string): T {
  const issues: string[] = []
  validateNode(schema, value, label, issues)
  if (issues.length > 0) throw new AgentProtocolError(issues)
  return value as T
}
