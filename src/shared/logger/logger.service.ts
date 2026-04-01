import { ConsoleLogger, ConsoleLoggerOptions, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { APP_CONFIG_TOKEN } from 'src/config/app.config'
import { LogLevel } from 'src/constant/logger.constant'
import type { Logger as WinstonLogger } from 'winston'
import { config, createLogger, format, transports } from 'winston'
import 'winston-daily-rotate-file'

/**
 * LoggerService — 应用级日志服务。
 *
 * 继承 NestJS 原生的 ConsoleLogger，根据环境自动切换输出策略：
 *
 *   - 开发环境（NODE_ENV !== 'production'）
 *       仅使用 NestJS 原生 ConsoleLogger，输出到控制台。
 *
 *   - 生产环境（NODE_ENV === 'production'）
 *       同时启用 ConsoleLogger 与 Winston DailyRotateFile，
 *       按日产生日志文件（最大 20MB / 保留 31 天）：
 *         logs/app.YYYY-MM-DD.log        INFO 乓级日志
 *         logs/app-warn.YYYY-MM-DD.log   WARN 乓级日志
 *         logs/app-error.YYYY-MM-DD.log  ERROR 乓级日志
 *
 * 通过 LoggerModule.forRoot() 全局注册。
 */
@Injectable()
export class LoggerService extends ConsoleLogger {
  /** 是否开发环境（由 APP_CONFIG_TOKEN.isDev 决定） */
  private isDev = true

  /** Winston 日志实例，生产环境下初始化 */
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

  /**
   * 初始化 Winston 轮转文件日志输出（仅在生产环境调用）。
   * 分别创建三个以日期分割的日志文件输出通道：
   *   - app.log        所有 INFO 及以上级别日志
   *   - app-warn.log   WARN 及以上级别日志
   *   - app-error.log  ERROR 日志
   */
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

  /** 输出 INFO 级别日志；生产环境同时写入 Winston。 */
  log(message: unknown, context?: string) {
    super.log(message, context)
    this.winstonLogger?.info(this.formatUnknownMessage(message), { context })
  }

  /** 输出 WARN 级别日志；生产环境同时写入 Winston。 */
  warn(message: unknown, context?: string) {
    super.warn(message, context)
    this.winstonLogger?.warn(this.formatUnknownMessage(message), { context })
  }

  /** 输出 ERROR 级别日志；生产环境同时写入 Winston。 */
  error(message: unknown, stack?: string, context?: string) {
    super.error(message, stack, context)
    this.winstonLogger?.error(this.formatUnknownMessage(message), { stack, context })
  }

  /** 仅开发环境打印日志，生产环境自动跳过，适用于调试信息。 */
  devLog(message: unknown, context?: string) {
    if (this.isDev) {
      this.log(message, context)
    }
  }

  private formatUnknownMessage(message: unknown): string {
    if (typeof message === 'string') {
      return message
    }

    if (message instanceof Error) {
      return message.message
    }

    try {
      return JSON.stringify(message)
    } catch {
      return String(message)
    }
  }
}
