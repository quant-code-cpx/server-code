import { Module } from '@nestjs/common'
import { ConvertibleBondRepository } from './convertible-bond.repository'
import { ConvertibleBondToolFacade } from './convertible-bond-tool.facade'

@Module({
  providers: [ConvertibleBondRepository, ConvertibleBondToolFacade],
  exports: [ConvertibleBondToolFacade],
})
export class ConvertibleBondModule {}
