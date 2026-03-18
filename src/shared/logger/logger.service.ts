import { ConsoleLogger, ConsoleLoggerOptions, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { APP_CONFIG_TOKEN } from 'src/config/app.config'
import { LogLevel } from 'src/constant/logger.constant'
import type { Logger as WinstonLogger } from 'winston'
import { config, createLogger, format, transports } from 'winston'
import 'winston-daily-rotate-file'

@Injectable()
export class LoggerService extends ConsoleLogger {
  private isDev = true
  private winstonLogger: WinstonLogger

  constructor(
    context: string,
    options: ConsoleLoggerOptions,
    private readonly configService: ConfigService,
  ) {
    super(context, options)
    this.isDev = this.configService.get(APP_CONFIG_TOKEN).isDev
    if (!this.isDev) {
      this.initWinstonLogger()
    }
  }

  private initWinstonLogger() {
    const baseConfig = {
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: 31,
    }

    this.winstonLogger = createLogger({
      levels: config.npm.levels,
      format: format.combine(format.errors({ stack: true }), format.timestamp(), format.json()),
      transports: [
        new transports.DailyRotateFile({
          ...baseConfig,
          level: LogLevel.INFO,
          filename: 'logs/app.%DATE%.log',
          auditFile: 'logs/.audit/app.json',
        }),
        new transports.DailyRotateFile({
          ...baseConfig,
          level: LogLevel.WARN,
          filename: 'logs/app-warn.%DATE%.log',
          auditFile: 'logs/.audit/app-warn.json',
        }),
        new transports.DailyRotateFile({
          ...baseConfig,
          level: LogLevel.ERROR,
          filename: 'logs/app-error.%DATE%.log',
          auditFile: 'logs/.audit/app-error.json',
        }),
      ],
    })
  }

  log(message: any, context?: string) {
    super.log(message, context)
    this.winstonLogger?.info(message, { context })
  }

  warn(message: any, context?: string) {
    super.warn(message, context)
    this.winstonLogger?.warn(message, { context })
  }

  error(message: any, stack?: string, context?: string) {
    super.error(message, stack, context)
    this.winstonLogger?.error(message, { stack, context })
  }

  /** 仅开发环境打印 */
  devLog(message: any, context?: string) {
    if (this.isDev) {
      this.log(message, context)
    }
  }
}
