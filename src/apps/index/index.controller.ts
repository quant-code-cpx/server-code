import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { IndexService } from './index.service'
import { IndexDailyQueryDto } from './dto/index-daily-query.dto'
import { IndexConstituentsQueryDto } from './dto/index-constituents-query.dto'
import { IndexInfoDto, IndexDailyResponseDto, IndexConstituentsResponseDto } from './dto/index-response.dto'

@ApiTags('Index - 指数')
@Controller('index')
export class IndexController {
  constructor(private readonly indexService: IndexService) {}

  @Post('list')
  @ApiOperation({ summary: '获取支持的核心指数列表' })
  @ApiSuccessResponse(IndexInfoDto, { isArray: true })
  getIndexList() {
    return this.indexService.getIndexList()
  }

  @Post('daily')
  @ApiOperation({ summary: '查询指数日线行情（支持单日/日期范围）' })
  @ApiSuccessResponse(IndexDailyResponseDto)
  getIndexDaily(@Body() query: IndexDailyQueryDto) {
    return this.indexService.getIndexDaily(query)
  }

  @Post('constituents')
  @ApiOperation({ summary: '查询指数成分股及权重' })
  @ApiSuccessResponse(IndexConstituentsResponseDto)
  getIndexConstituents(@Body() query: IndexConstituentsQueryDto) {
    return this.indexService.getIndexConstituents(query)
  }
}
