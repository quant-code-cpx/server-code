import { Global, Module } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'

const noopSchedulerRegistry: Pick<SchedulerRegistry, 'addCronJob' | 'doesExist'> = {
  addCronJob: () => undefined,
  doesExist: () => false,
}

/** Supplies the two legacy SchedulerRegistry calls without registering Cron jobs. */
@Global()
@Module({
  providers: [{ provide: SchedulerRegistry, useValue: noopSchedulerRegistry }],
  exports: [SchedulerRegistry],
})
export class NoopScheduleModule {}
