import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import {
  TechnicalSignalDefinitionListRequestDto,
  TechnicalSignalOccurrenceListRequestDto,
  TechnicalSignalStatisticsRequestDto,
} from './dto/technical-signal-request.dto'
import {
  TechnicalSignalDefinitionListResponseDto,
  TechnicalSignalOccurrenceListResponseDto,
  TechnicalSignalStatisticsResponseDto,
} from './dto/technical-signal-response.dto'
import { TechnicalSignalDefinitionService } from './services/technical-signal-definition.service'
import { TechnicalSignalStatisticsService } from './services/technical-signal-statistics.service'

@ApiTags('Technical Signal - 个股技术信号统计')
@ApiBearerAuth()
@Controller('stock/detail/analysis')
export class TechnicalSignalController {
  constructor(
    private readonly definitionService: TechnicalSignalDefinitionService,
    private readonly statisticsService: TechnicalSignalStatisticsService,
  ) {}

  @Post('signal-definitions/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '个股技术信号统计：标准信号定义目录' })
  @ApiSuccessResponse(TechnicalSignalDefinitionListResponseDto)
  listDefinitions(@Body() dto: TechnicalSignalDefinitionListRequestDto) {
    return this.definitionService.list(dto)
  }

  @Post('signal-statistics/query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '个股技术信号统计：全窗口摘要' })
  @ApiSuccessResponse(TechnicalSignalStatisticsResponseDto)
  queryStatistics(@Body() dto: TechnicalSignalStatisticsRequestDto) {
    return this.statisticsService.query(dto)
  }

  @Post('signal-occurrences/list')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '个股技术信号统计：信号样本明细' })
  @ApiSuccessResponse(TechnicalSignalOccurrenceListResponseDto)
  listOccurrences(@Body() dto: TechnicalSignalOccurrenceListRequestDto) {
    return this.statisticsService.listOccurrences(dto)
  }
}
