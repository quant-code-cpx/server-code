/**
 * Jest setupFilesAfterEnv — 每个测试文件执行前运行。
 * 1. 静默 NestJS Logger，避免测试输出被日志淹没
 * 2. 设置默认超时
 */
import { Logger } from '@nestjs/common'

// 静默 NestJS 内置 logger（不影响 console.error）
jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
jest.spyOn(Logger, 'log').mockImplementation(() => undefined)
jest.spyOn(Logger, 'warn').mockImplementation(() => undefined)
jest.spyOn(Logger, 'debug').mockImplementation(() => undefined)

// 测试默认超时 10s（Prisma 操作或 async 较慢时留余量）
jest.setTimeout(10_000)
