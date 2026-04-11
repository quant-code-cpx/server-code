import { Module } from '@nestjs/common'
import { PatternController } from './pattern.controller'
import { PatternService } from './pattern.service'

@Module({
  controllers: [PatternController],
  providers: [PatternService],
})
export class PatternModule {}
