import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { ResponseModel } from 'src/common/models/response.model'

/** 不需要 JSON 包装的路径（如 Prometheus metrics 返回纯文本） */
const RAW_PASSTHROUGH_PATHS = ['/metrics']

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const url = context.switchToHttp().getRequest().url as string
    if (RAW_PASSTHROUGH_PATHS.some((p) => url.startsWith(p))) {
      return next.handle()
    }

    return next.handle().pipe(
      map((data) => {
        if (data instanceof ResponseModel) return data
        return ResponseModel.success({ data })
      }),
    )
  }
}
