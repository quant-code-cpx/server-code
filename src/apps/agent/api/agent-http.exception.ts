import { HttpException } from '@nestjs/common'
import {
  AGENT_ERROR_BY_CODE,
  AGENT_ERROR_DEFINITIONS,
  type AgentErrorDefinition,
  type AgentErrorKey,
} from '../contracts'

const AGENT_ERROR_BY_KEY = new Map<AgentErrorKey, AgentErrorDefinition>(
  AGENT_ERROR_DEFINITIONS.map((definition) => [definition.key, definition]),
)

export class AgentHttpException extends HttpException {
  constructor(
    readonly definition: AgentErrorDefinition,
    message = definition.message,
    data?: Record<string, unknown>,
  ) {
    super({ code: definition.code, message, data }, definition.httpStatus)
    this.name = AgentHttpException.name
  }

  static fromKey(key: AgentErrorKey, message?: string, data?: Record<string, unknown>): AgentHttpException {
    const definition = AGENT_ERROR_BY_KEY.get(key)
    if (!definition) throw new Error(`未知 Agent error key: ${key}`)
    return new AgentHttpException(definition, message, data)
  }

  static fromCode(code: number, message?: string, data?: Record<string, unknown>): AgentHttpException {
    const definition = AGENT_ERROR_BY_CODE.get(code)
    if (!definition) throw new Error(`未知 Agent error code: ${code}`)
    return new AgentHttpException(definition, message, data)
  }
}
