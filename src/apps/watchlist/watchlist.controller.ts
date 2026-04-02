import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { WatchlistService } from './watchlist.service'
import {
  AddWatchlistStockDto,
  BatchAddStocksDto,
  BatchRemoveStocksDto,
  CreateWatchlistDto,
  ReorderWatchlistsDto,
  UpdateWatchlistDto,
  UpdateWatchlistStockDto,
} from './dto/watchlist.dto'

@ApiTags('Watchlist - 自选股')
@UseGuards(JwtAuthGuard)
@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  // ── 自选股组 ────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: '获取用户所有自选组（含股票数量）' })
  getWatchlists(@CurrentUser() user: TokenPayload) {
    return this.watchlistService.getWatchlists(user.id)
  }

  @Get('overview')
  @ApiOperation({ summary: '所有自选组快速概览' })
  getOverview(@CurrentUser() user: TokenPayload) {
    return this.watchlistService.getOverview(user.id)
  }

  @Post()
  @ApiOperation({ summary: '创建自选组' })
  createWatchlist(@CurrentUser() user: TokenPayload, @Body() dto: CreateWatchlistDto) {
    return this.watchlistService.createWatchlist(user.id, dto)
  }

  @Put('reorder')
  @ApiOperation({ summary: '批量更新自选组排序' })
  reorderWatchlists(@CurrentUser() user: TokenPayload, @Body() dto: ReorderWatchlistsDto) {
    return this.watchlistService.reorderWatchlists(user.id, dto)
  }

  @Put(':id')
  @ApiOperation({ summary: '更新自选组（名称/描述/排序/默认标记）' })
  updateWatchlist(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWatchlistDto,
  ) {
    return this.watchlistService.updateWatchlist(user.id, id, dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除自选组（级联删除成员）' })
  deleteWatchlist(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.watchlistService.deleteWatchlist(user.id, id)
  }

  // ── 自选股成员 ────────────────────────────────────────────────────────────

  @Get(':id/stocks')
  @ApiOperation({ summary: '获取自选组内股票列表（含最新行情）' })
  getStocks(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.watchlistService.getStocks(user.id, id)
  }

  @Post(':id/stocks')
  @ApiOperation({ summary: '添加单只股票到自选组' })
  addStock(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddWatchlistStockDto,
  ) {
    return this.watchlistService.addStock(user.id, id, dto)
  }

  @Post(':id/stocks/batch')
  @ApiOperation({ summary: '批量添加股票到自选组' })
  batchAddStocks(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BatchAddStocksDto,
  ) {
    return this.watchlistService.batchAddStocks(user.id, id, dto)
  }

  @Put(':id/stocks/reorder')
  @ApiOperation({ summary: '批量更新组内股票排序' })
  reorderStocks(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderWatchlistsDto,
  ) {
    return this.watchlistService.reorderStocks(user.id, id, dto)
  }

  @Put(':id/stocks/:stockId')
  @ApiOperation({ summary: '更新股票备注/标签/目标价' })
  updateStock(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('stockId', ParseIntPipe) stockId: number,
    @Body() dto: UpdateWatchlistStockDto,
  ) {
    return this.watchlistService.updateStock(user.id, id, stockId, dto)
  }

  @Delete(':id/stocks/batch')
  @ApiOperation({ summary: '批量移除股票' })
  batchRemoveStocks(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BatchRemoveStocksDto,
  ) {
    return this.watchlistService.batchRemoveStocks(user.id, id, dto)
  }

  @Delete(':id/stocks/:stockId')
  @ApiOperation({ summary: '从自选组移除股票' })
  removeStock(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Param('stockId', ParseIntPipe) stockId: number,
  ) {
    return this.watchlistService.removeStock(user.id, id, stockId)
  }

  @Get(':id/summary')
  @ApiOperation({ summary: '获取自选组行情汇总（涨跌统计 + 平均涨幅）' })
  getWatchlistSummary(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.watchlistService.getWatchlistSummary(user.id, id)
  }
}
