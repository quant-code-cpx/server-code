import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { HeatmapService } from './heatmap.service'
import { HeatmapQueryDto } from './dto/heatmap-query.dto'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { HeatmapItemDto } from './dto/heatmap-response.dto'

@ApiTags('Heatmap - 热力图')
@Controller('heatmap')
export class HeatmapController {
  constructor(private readonly heatmapService: HeatmapService) {}

  @Post('data')
  @ApiOperation({ summary: '获取市场热力图数据（涨跌幅分布）' })
  @ApiSuccessResponse(HeatmapItemDto, { isArray: true })
  getHeatmap(@Body() query: HeatmapQueryDto) {
    return this.heatmapService.getHeatmap(query)
  }
}
