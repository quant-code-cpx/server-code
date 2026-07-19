import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable, catchError, throwError } from 'rxjs'
import { AGENT_ERROR_DEFINITIONS, type AgentErrorKey } from '../contracts'
import { AgentHttpException } from './agent-http.exception'

const AGENT_ERROR_KEYS = new Set<string>(AGENT_ERROR_DEFINITIONS.map((definition) => definition.key))
const VALIDATION_ERROR_CODES = new Set([
  'AI_CONVERSATION_ARCHIVED',
  'AI_CONVERSATION_VALIDATION_FAILED',
  'AI_MESSAGE_VALIDATION_FAILED',
  'AI_CURSOR_INVALID',
])

@Injectable()
export class AgentErrorInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof AgentHttpException) return throwError(() => error)
        const code = readString(error, 'code')
        const message = error instanceof Error ? error.message : 'Agent 请求失败'
        if (code && AGENT_ERROR_KEYS.has(code)) {
          return throwError(() => AgentHttpException.fromKey(code as AgentErrorKey, message))
        }
        if (code && VALIDATION_ERROR_CODES.has(code)) {
          return throwError(() => new BadRequestException([message]))
        }
        const agentCode = readNumber(error, 'agentCode')
        if (agentCode != null) return throwError(() => AgentHttpException.fromCode(agentCode, message))
        return throwError(() => error)
      }),
    )
  }
}

function readString(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null
  const result = (value as Record<string, unknown>)[key]
  return typeof result === 'string' ? result : null
}

function readNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== 'object') return null
  const result = (value as Record<string, unknown>)[key]
  return typeof result === 'number' ? result : null
}
