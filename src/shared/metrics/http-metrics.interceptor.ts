import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { InjectMetric } from '@willsoto/nestjs-prometheus'
import { Counter, Histogram } from 'prom-client'
import { Observable, tap } from 'rxjs'
import { HTTP_REQUEST_DURATION, HTTP_REQUEST_TOTAL, HTTP_REQUEST_ERRORS } from './metrics.constants'

/** 健康检查等不需要计量的路径 */
const EXCLUDED_PATHS = ['/metrics', '/health', '/ready', '/api/health', '/api/ready']

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric(HTTP_REQUEST_DURATION) private readonly durationHistogram: Histogram,
    @InjectMetric(HTTP_REQUEST_TOTAL) private readonly requestCounter: Counter,
    @InjectMetric(HTTP_REQUEST_ERRORS) private readonly errorCounter: Counter,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest()
    const { method, url } = request

    if (EXCLUDED_PATHS.some((p) => url.startsWith(p))) {
      return next.handle()
    }

    const route = this.extractRoute(context)
    const endTimer = this.durationHistogram.startTimer({ method, route })

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode = context.switchToHttp().getResponse().statusCode
          const labels = { method, route, status_code: String(statusCode) }
          endTimer(labels)
          this.requestCounter.inc(labels)
          if (statusCode >= 400) {
            this.errorCounter.inc(labels)
          }
        },
        error: (error: { status?: number }) => {
          const statusCode = error?.status ?? 500
          const labels = { method, route, status_code: String(statusCode) }
          endTimer(labels)
          this.requestCounter.inc(labels)
          this.errorCounter.inc(labels)
        },
      }),
    )
  }

  /**
   * 从 ExecutionContext 中提取 Controller 路由模式（例如 /api/stock/:id），
   * 避免使用真实路径导致 Prometheus label 基数爆炸。
   */
  private extractRoute(context: ExecutionContext): string {
    const request = context.switchToHttp().getRequest()
    return (request.route?.path as string) || 'UNKNOWN'
  }
}
