import { DynamicModule, Module } from '@nestjs/common'
import { LoggerService } from './logger.service'

@Module({})
export class LoggerModule {
  static forRoot(): DynamicModule {
    return {
      global: true,
      module: LoggerModule,
      providers: [LoggerService],
      exports: [LoggerService],
    }
  }
}
