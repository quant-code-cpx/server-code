import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { Roles } from 'src/common/decorators/roles.decorator'
import { ApiSuccessRawResponse, ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { HeatmapService } from './heatmap.service'
import { HeatmapSnapshotService } from './heatmap-snapshot.service'
import { HeatmapQueryDto } from './dto/heatmap-query.dto'
import { HeatmapItemDto } from './dto/heatmap-response.dto'
import { TriggerSnapshotDto } from './dto/trigger-snapshot.dto'
import { HeatmapHistoryQueryDto } from './dto/heatmap-history-query.dto'

@ApiBearerAuth()
@ApiTags('Heatmap - 热力图')
@Controller('heatmap')
export class HeatmapController {
  constructor(
    private readonly heatmapService: HeatmapService,
    private readonly heatmapSnapshotService: HeatmapSnapshotService,
  ) {}

  @Post('data')
  @ApiOperation({ summary: '获取市场热力图数据（涨跌幅分布）' })
  @ApiSuccessResponse(HeatmapItemDto, { isArray: true })
  getHeatmap(@Body() query: HeatmapQueryDto) {
    return this.heatmapService.getHeatmap(query)
  }

  @Post('snapshot/trigger')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '手动触发热力图快照聚合（管理员）' })
  @ApiSuccessRawResponse({ type: 'object' })
  triggerSnapshot(@Body() dto: TriggerSnapshotDto) {
    return this.heatmapSnapshotService.aggregateSnapshot(dto.trade_date)
  }

  @Post('snapshot/history')
  @ApiOperation({ summary: '查询指定日期热力图快照（优先读缓存，自动降级实时计算）' })
  @ApiSuccessRawResponse({ type: 'object' })
  getSnapshotHistory(@Body() dto: HeatmapHistoryQueryDto) {
    return this.heatmapSnapshotService.queryHistory(dto)
  }
}
