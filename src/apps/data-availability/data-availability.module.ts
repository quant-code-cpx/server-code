import { Module } from '@nestjs/common'
import { DataAvailabilityRepository } from './data-availability.repository'
import { DataAvailabilityToolFacade } from './data-availability-tool.facade'

@Module({
  providers: [DataAvailabilityRepository, DataAvailabilityToolFacade],
  exports: [DataAvailabilityToolFacade],
})
export class DataAvailabilityModule {}
