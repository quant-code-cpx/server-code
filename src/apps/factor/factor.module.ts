import { Module } from '@nestjs/common'
import { FactorController } from './factor.controller'
import { FactorService } from './factor.service'
import { FactorLibraryService } from './services/factor-library.service'
import { FactorComputeService } from './services/factor-compute.service'

@Module({
  controllers: [FactorController],
  providers: [FactorService, FactorLibraryService, FactorComputeService],
})
export class FactorModule {}
