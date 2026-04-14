import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ResponseModel } from 'src/common/models/response.model'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { RequestContextService } from 'src/shared/context/request-context.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import { TushareApiError } from 'src/tushare/api/tushare-client.service'

interface ExceptionBody {
  message?: string | string[]
  data?: unknown
}

interface ExceptionLike {
  message?: string
  response?: unknown
  status?: number
  statusCode?: number
}

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
    const status = this.resolveStatus(exception)
    const responseBody = this.resolveResponseBody(exception)
    const validationMessages = Array.isArray(responseBody?.message) ? responseBody.message.map(String) : null
    let data = responseBody?.data
    let message = this.resolveMessage(exception, responseBody)

    if (status === HttpStatus.INTERNAL_SERVER_ERROR && !(exception instanceof BusinessException)) {
      const traceId = RequestContextService.getTraceId()
      this.loggerService.error(
        {
          message: exception instanceof Error ? exception.message : String(exception ?? 'unknown'),
          traceId,
        },
        exception instanceof Error ? exception.stack : undefined,
        'GlobalExceptionsFilter',
      )
      if (!this.isDev) {
        message = ErrorEnum.SERVER_ERROR.split(':')[1]
      }
    } else {
      this.loggerService.warn(`(${status}) ${message} Path: ${decodeURI(url)}`)
    }

    let apiErrorCode: number
    if (exception instanceof BusinessException) {
      apiErrorCode = exception.getErrorCode()
    } else if (exception instanceof TushareApiError) {
      apiErrorCode = this.parseErrorCode(ErrorEnum.TUSHARE_API_ERROR)
      data = {
        ...(this.isRecord(data) ? data : {}),
        apiName: exception.apiName,
        tushareCode: exception.code,
      }
      if (!this.isDev) {
        message = this.parseErrorMessage(ErrorEnum.TUSHARE_API_ERROR)
      }
    } else if (exception instanceof BadRequestException && validationMessages) {
      apiErrorCode = this.parseErrorCode(ErrorEnum.VALIDATION_ERROR)
      data = { details: validationMessages }
      message = this.parseErrorMessage(ErrorEnum.VALIDATION_ERROR)
    } else {
      apiErrorCode = status
    }

    response.status(status).json(ResponseModel.error({ code: apiErrorCode, message, data }))
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus()
    }

    if (this.isRecord(exception)) {
      const status = exception.status ?? exception.statusCode
      if (typeof status === 'number') {
        return status
      }
    }

    return HttpStatus.INTERNAL_SERVER_ERROR
  }

  private resolveResponseBody(exception: unknown): ExceptionBody | undefined {
    if (exception instanceof HttpException) {
      const response = exception.getResponse()
      if (typeof response === 'string') {
        return { message: response }
      }
      if (this.isRecord(response)) {
        return response as ExceptionBody
      }
      return undefined
    }

    if (this.isRecord(exception) && this.isRecord(exception.response)) {
      return exception.response as ExceptionBody
    }

    return undefined
  }

  private resolveMessage(exception: unknown, responseBody?: ExceptionBody): string {
    if (Array.isArray(responseBody?.message)) {
      return responseBody.message.map(String).join('; ')
    }

    if (typeof responseBody?.message === 'string') {
      return responseBody.message
    }

    if (exception instanceof Error) {
      return exception.message
    }

    if (this.isRecord(exception) && typeof exception.message === 'string') {
      return exception.message
    }

    return `${exception}`
  }

  private parseErrorCode(error: ErrorEnum): number {
    return Number(error.split(':')[0])
  }

  private parseErrorMessage(error: ErrorEnum): string {
    return error.split(':')[1] ?? '服务繁忙，请稍后再试'
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }
}
