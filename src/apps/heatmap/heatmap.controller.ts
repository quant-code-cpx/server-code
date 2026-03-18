import { Controller, Get, Query } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { HeatmapService } from './heatmap.service'
import { HeatmapQueryDto } from './dto/heatmap-query.dto'

@ApiTags('Heatmap - 热力图')
@Controller('heatmap')
export class HeatmapController {
  constructor(private readonly heatmapService: HeatmapService) {}

  @Get()
  @ApiOperation({ summary: '获取市场热力图数据（涨跌幅分布）' })
  getHeatmap(@Query() query: HeatmapQueryDto) {
    return this.heatmapService.getHeatmap(query)
  }
}
