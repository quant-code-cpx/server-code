import { Module } from '@nestjs/common'
import { SharedModule } from 'src/shared/shared.module'
import { WorkerReadinessService } from './worker-readiness.service'

@Module({
  imports: [SharedModule],
  providers: [WorkerReadinessService],
})
export class WorkerReadinessModule {}
