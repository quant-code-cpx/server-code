import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { PatternSearchBySeriesDto, PatternSearchDto } from './dto/pattern-search.dto'
import { PatternSearchResultDto } from './dto/pattern-response.dto'
import { PatternService } from './pattern.service'

@ApiTags('Pattern - 相似 K 线形态匹配')
@ApiBearerAuth()
@Controller('pattern')
export class PatternController {
  constructor(private readonly patternService: PatternService) {}

  @Get('templates')
  @ApiOperation({ summary: '获取预定义经典形态模板列表（头肩顶、双底、旗形等）' })
  getTemplates() {
    return this.patternService.getTemplates()
  }

  @Post('search')
  @ApiOperation({ summary: '相似 K 线形态搜索（基于股票日线区间）' })
  @ApiSuccessResponse(PatternSearchResultDto)
  search(@Body() dto: PatternSearchDto) {
    return this.patternService.search(dto)
  }

  @Post('search-by-series')
  @ApiOperation({ summary: '相似形态搜索（基于自定义价格序列）' })
  @ApiSuccessResponse(PatternSearchResultDto)
  searchBySeries(@Body() dto: PatternSearchBySeriesDto) {
    return this.patternService.searchBySeries(dto)
  }
}
