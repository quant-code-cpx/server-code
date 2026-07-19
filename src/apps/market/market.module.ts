import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentToolsConfig } from 'src/config/agent-tools.config'
import { MarketController } from './market.controller'
import { MarketService } from './market.service'
import { MarketToolFacade } from './market-tool.facade'

@Module({
  imports: [ConfigModule.forFeature(AgentToolsConfig)],
  controllers: [MarketController],
  providers: [MarketService, MarketToolFacade],
  exports: [MarketToolFacade],
})
export class MarketModule {}
