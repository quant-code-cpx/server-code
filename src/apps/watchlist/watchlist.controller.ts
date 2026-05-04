import { Body, Controller, Post, UseGuards } from '@nestjs/common'
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
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import {
  BatchAddResponseDto,
  BatchRemoveResponseDto,
  WatchlistDto,
  WatchlistMessageResponseDto,
  WatchlistOverviewItemDto,
  WatchlistOverviewResponseDto,
  WatchlistOverviewSummaryDto,
  WatchlistStockDto,
  WatchlistStocksResponseDto,
} from './dto/watchlist-response.dto'

@ApiTags('Watchlist - 自选股')
@UseGuards(JwtAuthGuard)
@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  // ── 自选股组 ────────────────────────────────────────────────────────────

  @Post('list')
  @ApiOperation({ summary: '获取用户所有自选组（含股票数量）' })
  @ApiSuccessResponse(WatchlistDto, { isArray: true })
  getWatchlists(@CurrentUser() user: TokenPayload) {
    return this.watchlistService.getWatchlists(user.id)
  }

  @Post('overview')
  @ApiOperation({ summary: '所有自选组快速概览' })
  @ApiSuccessResponse(WatchlistOverviewResponseDto)
  getOverview(@CurrentUser() user: TokenPayload) {
    return this.watchlistService.getOverview(user.id)
  }

  @Post('create')
  @ApiOperation({ summary: '创建自选组' })
  @ApiSuccessResponse(WatchlistDto)
  createWatchlist(@CurrentUser() user: TokenPayload, @Body() dto: CreateWatchlistDto) {
    return this.watchlistService.createWatchlist(user.id, dto)
  }

  @Post('reorder')
  @ApiOperation({ summary: '批量更新自选组排序' })
  @ApiSuccessResponse(WatchlistMessageResponseDto)
  reorderWatchlists(@CurrentUser() user: TokenPayload, @Body() dto: ReorderWatchlistsDto) {
    return this.watchlistService.reorderWatchlists(user.id, dto)
  }

  @Post('update')
  @ApiOperation({ summary: '更新自选组（名称/描述/排序/默认标记）' })
  @ApiSuccessResponse(WatchlistDto)
  updateWatchlist(@CurrentUser() user: TokenPayload, @Body() dto: UpdateWatchlistDto & { id: number }) {
    return this.watchlistService.updateWatchlist(user.id, dto.id, dto)
  }

  @Post('delete')
  @ApiOperation({ summary: '删除自选组（级联删除成员）' })
  @ApiSuccessResponse(WatchlistMessageResponseDto)
  deleteWatchlist(@CurrentUser() user: TokenPayload, @Body() { id }: { id: number }) {
    return this.watchlistService.deleteWatchlist(user.id, id)
  }

  // ── 自选股成员 ────────────────────────────────────────────────────────────

  @Post('stocks/list')
  @ApiOperation({ summary: '获取自选组内股票列表（含最新行情）' })
  @ApiSuccessResponse(WatchlistStocksResponseDto)
  getStocks(@CurrentUser() user: TokenPayload, @Body() { id }: { id: number }) {
    return this.watchlistService.getStocks(user.id, id)
  }

  @Post('stocks')
  @ApiOperation({ summary: '添加单只股票到自选组' })
  @ApiSuccessResponse(WatchlistStockDto)
  addStock(@CurrentUser() user: TokenPayload, @Body() dto: AddWatchlistStockDto & { id: number }) {
    return this.watchlistService.addStock(user.id, dto.id, dto)
  }

  @Post('stocks/batch')
  @ApiOperation({ summary: '批量添加股票到自选组' })
  @ApiSuccessResponse(BatchAddResponseDto)
  batchAddStocks(@CurrentUser() user: TokenPayload, @Body() dto: BatchAddStocksDto & { id: number }) {
    return this.watchlistService.batchAddStocks(user.id, dto.id, dto)
  }

  @Post('stocks/reorder')
  @ApiOperation({ summary: '批量更新组内股票排序' })
  @ApiSuccessResponse(WatchlistMessageResponseDto)
  reorderStocks(@CurrentUser() user: TokenPayload, @Body() dto: ReorderWatchlistsDto & { id: number }) {
    return this.watchlistService.reorderStocks(user.id, dto.id, dto)
  }

  @Post('stocks/update')
  @ApiOperation({ summary: '更新股票备注/标签/目标价' })
  @ApiSuccessResponse(WatchlistStockDto)
  updateStock(
    @CurrentUser() user: TokenPayload,
    @Body() dto: UpdateWatchlistStockDto & { id: number; stockId: number },
  ) {
    return this.watchlistService.updateStock(user.id, dto.id, dto.stockId, dto)
  }

  @Post('stocks/batch/delete')
  @ApiOperation({ summary: '批量移除股票' })
  @ApiSuccessResponse(BatchRemoveResponseDto)
  batchRemoveStocks(@CurrentUser() user: TokenPayload, @Body() dto: BatchRemoveStocksDto & { id: number }) {
    return this.watchlistService.batchRemoveStocks(user.id, dto.id, dto)
  }

  @Post('stocks/delete')
  @ApiOperation({ summary: '从自选组移除股票' })
  @ApiSuccessResponse(WatchlistMessageResponseDto)
  removeStock(@CurrentUser() user: TokenPayload, @Body() { id, stockId }: { id: number; stockId: number }) {
    return this.watchlistService.removeStock(user.id, id, stockId)
  }

  @Post('summary')
  @ApiOperation({ summary: '获取自选组行情汇总（涨跌统计 + 平均涨幅）' })
  @ApiSuccessResponse(WatchlistOverviewSummaryDto)
  getWatchlistSummary(@CurrentUser() user: TokenPayload, @Body() { id }: { id: number }) {
    return this.watchlistService.getWatchlistSummary(user.id, id)
  }
}
