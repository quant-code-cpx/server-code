import { Module } from '@nestjs/common'
import { WatchlistController } from './watchlist.controller'
import { WatchlistService } from './watchlist.service'
import { WatchlistToolFacade } from './watchlist-tool.facade'

@Module({
  controllers: [WatchlistController],
  providers: [WatchlistService, WatchlistToolFacade],
  exports: [WatchlistToolFacade],
})
export class WatchlistModule {}
