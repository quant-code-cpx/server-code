import { DynamicModule, Module } from '@nestjs/common'
import { LoggerService } from './logger.service'

/**
 * LoggerModule — 日志模块。
 *
 * 使用动态模块模式（forRoot），由 SharedModule 调用并全局展开。
 *
 * 导出 LoggerService，全局可用，无需在各模块重复导入。
 */
@Module({})
export class LoggerModule {
  /**
   * 创建全局日志动态模块。
   * 由 SharedModule.imports 调用，吟持 global: true，可被所有子模块使用。
   */
  static forRoot(): DynamicModule {
    return {
      global: true,
      module: LoggerModule,
      providers: [LoggerService],
      exports: [LoggerService],
    }
  }
}
