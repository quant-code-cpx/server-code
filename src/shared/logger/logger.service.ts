import { ConsoleLogger, ConsoleLoggerOptions, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { APP_CONFIG_TOKEN } from 'src/config/app.config'
import { LogLevel } from 'src/constant/logger.constant'
import { RequestContextService } from 'src/shared/context/request-context.service'
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
 *       根据 LOG_OUTPUT 启用 stdout 或 Winston DailyRotateFile，
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
  private winstonLogger?: WinstonLogger
  private logOutput: LogOutput = 'stdout'

  constructor(
    context: string,
    options: ConsoleLoggerOptions,
    private readonly configService: ConfigService,
  ) {
    super(context, options)
    this.isDev = this.configService.get(APP_CONFIG_TOKEN).isDev
    if (!this.isDev) {
      this.logOutput = resolveLogOutput(process.env.LOG_OUTPUT)
      this.initWinstonLogger()
    }
  }

  /**
   * 初始化生产日志输出（仅在生产环境调用）。
   * file/both 时创建三个以日期分割的日志文件输出通道：
   *   - app.log        所有 INFO 及以上级别日志
   *   - app-warn.log   WARN 及以上级别日志
   *   - app-error.log  ERROR 日志
   */
  private initWinstonLogger() {
    if (!usesFileLogTransport(this.logOutput)) {
      this.winstonLogger = createLogger({
        levels: config.npm.levels,
        format: this.createWinstonFormat(),
        transports: [new transports.Console()],
      })
      return
    }

    const baseConfig = {
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: 31,
    }

    const fileTransports = [
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
    ]
    this.winstonLogger = createLogger({
      levels: config.npm.levels,
      format: this.createWinstonFormat(),
      transports: this.logOutput === 'file' ? fileTransports : [new transports.Console(), ...fileTransports],
    })
  }

  private createWinstonFormat() {
    return format.combine(
      format.errors({ stack: true }),
      format.timestamp(),
      // 注入请求上下文字段（traceId / userId / method / url）
      format((info) => {
        const ctx = RequestContextService.getCurrentContext()
        if (ctx) {
          info.traceId = ctx.traceId
          info.userId = ctx.userId ?? null
          info.method = ctx.method ?? null
          info.url = ctx.url ?? null
        }
        return info
      })(),
      format.json(),
    )
  }

  /** 输出 INFO 级别日志；生产环境同时写入 Winston。 */
  log(message: unknown, context?: string) {
    const displayMessage = this.formatUnknownMessage(message)
    if (this.winstonLogger) {
      this.winstonLogger.info(this.toWinstonPayload(message, context))
    } else {
      super.log(displayMessage, context)
    }
  }

  /** 输出 WARN 级别日志；生产环境同时写入 Winston。 */
  warn(message: unknown, context?: string) {
    const displayMessage = this.formatUnknownMessage(message)
    if (this.winstonLogger) {
      this.winstonLogger.warn(this.toWinstonPayload(message, context))
    } else {
      super.warn(displayMessage, context)
    }
  }

  /** 输出 ERROR 级别日志；生产环境同时写入 Winston。 */
  error(message: unknown, stack?: string, context?: string) {
    const displayMessage = this.formatUnknownMessage(message)
    if (this.winstonLogger) {
      if (typeof message === 'object' && message !== null && !(message instanceof Error)) {
        this.winstonLogger.error({ ...(message as object), stack, context })
      } else {
        this.winstonLogger.error(displayMessage, { stack, context })
      }
    } else {
      super.error(displayMessage, stack, context)
    }
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

  /**
   * 将 message 转换为 Winston 日志 payload。
   * 对象类型 message 直接展开，确保字段平铺在 JSON 中；
   * 其他类型转为 string 后作为 message 字段写入。
   */
  private toWinstonPayload(message: unknown, context?: string): Record<string, unknown> {
    if (typeof message === 'object' && message !== null && !(message instanceof Error)) {
      return { ...(message as object), context }
    }
    return { message: this.formatUnknownMessage(message), context }
  }
}

type LogOutput = 'stdout' | 'file' | 'both'

export function resolveLogOutput(value: string | undefined): LogOutput {
  const output = value?.trim().toLowerCase() || 'stdout'
  if (output === 'stdout' || output === 'file' || output === 'both') return output
  throw new Error('[Logger] LOG_OUTPUT only supports stdout, file, or both')
}

export function usesFileLogTransport(output: LogOutput): boolean {
  return output === 'file' || output === 'both'
}
