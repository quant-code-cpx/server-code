import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ResponseModel } from 'src/common/models/response.model'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { LoggerService } from 'src/shared/logger/logger.service'

@Catch()
export class GlobalExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly isDev: boolean,
    private readonly loggerService: LoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const request = ctx.getRequest()
    const response = ctx.getResponse()

    const url: string = request.url ?? ''
    const status: number =
      exception instanceof HttpException
        ? exception.getStatus()
        : ((exception as any)?.status ?? (exception as any)?.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR)

    let message: string = (exception as any)?.response?.message ?? (exception as any)?.message ?? `${exception}`

    if (status === HttpStatus.INTERNAL_SERVER_ERROR && !(exception instanceof BusinessException)) {
      this.loggerService.error(exception, (exception as Error).stack, 'GlobalExceptionsFilter')
      if (!this.isDev) {
        message = ErrorEnum.SERVER_ERROR.split(':')[1]
      }
    } else {
      this.loggerService.warn(`(${status}) ${message} Path: ${decodeURI(url)}`)
    }

    const apiErrorCode: number = exception instanceof BusinessException ? exception.getErrorCode() : status

    response.status(status).json(ResponseModel.error({ code: apiErrorCode, message }))
  }
}
