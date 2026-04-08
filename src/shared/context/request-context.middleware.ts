import { Injectable, NestMiddleware } from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'
import { randomBytes } from 'node:crypto'
import { RequestContextService } from './request-context.service'

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // 优先从上游代理/网关获取 trace ID，否则自动生成
    const traceId =
      (req.headers['x-trace-id'] as string) || (req.headers['x-request-id'] as string) || randomBytes(8).toString('hex')

    const context = {
      traceId,
      method: req.method,
      url: req.originalUrl || req.url,
      startTime: Date.now(),
    }

    // 将 traceId 写入响应头，便于客户端关联
    res.setHeader('X-Trace-Id', traceId)

    RequestContextService.run(context, () => next())
  }
}
