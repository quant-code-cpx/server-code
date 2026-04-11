import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { IndustryRotationService } from './industry-rotation.service'
import { ReturnComparisonQueryDto } from './dto/return-comparison-query.dto'
import { MomentumRankingQueryDto } from './dto/momentum-ranking-query.dto'
import { FlowAnalysisQueryDto } from './dto/flow-analysis-query.dto'
import { IndustryValuationQueryDto } from './dto/industry-valuation-query.dto'
import { RotationOverviewQueryDto } from './dto/rotation-overview-query.dto'
import { IndustryDetailQueryDto } from './dto/industry-detail-query.dto'
import { RotationHeatmapQueryDto } from './dto/rotation-heatmap-query.dto'
import {
  ReturnComparisonResponseDto,
  MomentumRankingResponseDto,
  FlowAnalysisResponseDto,
  IndustryValuationResponseDto,
  RotationOverviewResponseDto,
  IndustryDetailResponseDto,
  RotationHeatmapResponseDto,
} from './dto/industry-rotation-response.dto'

@ApiTags('行业轮动分析')
@Controller('industry-rotation')
export class IndustryRotationController {
  constructor(private readonly service: IndustryRotationService) {}

  @Post('return-comparison')
  @ApiOperation({ summary: '行业收益对比' })
  @ApiSuccessResponse(ReturnComparisonResponseDto)
  getReturnComparison(@Body() query: ReturnComparisonQueryDto) {
    return this.service.getReturnComparison(query)
  }

  @Post('momentum-ranking')
  @ApiOperation({ summary: '行业动量排名' })
  @ApiSuccessResponse(MomentumRankingResponseDto)
  getMomentumRanking(@Body() query: MomentumRankingQueryDto) {
    return this.service.getMomentumRanking(query)
  }

  @Post('flow-analysis')
  @ApiOperation({ summary: '行业资金流转分析' })
  @ApiSuccessResponse(FlowAnalysisResponseDto)
  getFlowAnalysis(@Body() query: FlowAnalysisQueryDto) {
    return this.service.getFlowAnalysis(query)
  }

  @Post('valuation')
  @ApiOperation({ summary: '行业估值分位' })
  @ApiSuccessResponse(IndustryValuationResponseDto)
  getIndustryValuation(@Body() query: IndustryValuationQueryDto) {
    return this.service.getIndustryValuation(query)
  }

  @Post('overview')
  @ApiOperation({ summary: '行业轮动总览' })
  @ApiSuccessResponse(RotationOverviewResponseDto)
  getOverview(@Body() query: RotationOverviewQueryDto) {
    return this.service.getOverview(query)
  }

  @Post('detail')
  @ApiOperation({ summary: '单行业详情' })
  @ApiSuccessResponse(IndustryDetailResponseDto)
  getDetail(@Body() query: IndustryDetailQueryDto) {
    return this.service.getDetail(query)
  }

  @Post('heatmap')
  @ApiOperation({ summary: '行业轮动热力图' })
  @ApiSuccessResponse(RotationHeatmapResponseDto)
  getHeatmap(@Body() query: RotationHeatmapQueryDto) {
    return this.service.getHeatmap(query)
  }
}
