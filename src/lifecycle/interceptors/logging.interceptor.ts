import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable, tap } from 'rxjs'
import { RequestContextService } from 'src/shared/context/request-context.service'
import { LoggerService } from 'src/shared/logger/logger.service'

const EXCLUDED_PATHS = ['/health', '/ready', '/api/health', '/api/ready']

const SENSITIVE_FIELDS = ['password', 'newPassword', 'oldPassword', 'token', 'secret', 'captchaCode']

function sanitizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  if (Array.isArray(body)) return body.map(sanitizeBody)
  const sanitized = { ...(body as Record<string, unknown>) }
  for (const [key, value] of Object.entries(sanitized)) {
    if (SENSITIVE_FIELDS.includes(key)) {
      sanitized[key] = '***'
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeBody(value)
    }
  }
  return sanitized
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly loggerService: LoggerService,
    private readonly logHttpBody = false,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest()
    const response = context.switchToHttp().getResponse()
    const { method, url, ip } = request
    const userAgent = request.get('user-agent') || ''

    // 健康检查端点不记录日志，避免日志洪泛
    if (EXCLUDED_PATHS.some((p) => url.startsWith(p))) {
      return next.handle()
    }

    const start = Date.now()

    return next.handle().pipe(
      tap({
        next: () => {
          const latency = Date.now() - start
          const statusCode = response.statusCode
          const ctx = RequestContextService.getCurrentContext()

          const logData: Record<string, unknown> = {
            message: `${method} ${url} ${statusCode} ${latency}ms`,
            latency,
            statusCode,
            ip,
            userAgent,
            traceId: ctx?.traceId,
            userId: ctx?.userId,
          }

          if (this.logHttpBody && request.body && Object.keys(request.body).length > 0) {
            logData.body = sanitizeBody(request.body)
          }

          this.loggerService.log(logData, 'HTTP')
        },
        error: (error) => {
          const latency = Date.now() - start
          const ctx = RequestContextService.getCurrentContext()

          this.loggerService.warn(
            {
              message: `${method} ${url} ERROR ${latency}ms`,
              latency,
              ip,
              userAgent,
              traceId: ctx?.traceId,
              userId: ctx?.userId,
              error: (error as Error)?.message,
            },
            'HTTP',
          )
        },
      }),
    )
  }
}
