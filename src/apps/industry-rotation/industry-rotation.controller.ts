import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { IndustryRotationService } from './industry-rotation.service'
import { ReturnComparisonQueryDto } from './dto/return-comparison-query.dto'
import { MomentumRankingQueryDto } from './dto/momentum-ranking-query.dto'
import { FlowAnalysisQueryDto } from './dto/flow-analysis-query.dto'
import { IndustryValuationQueryDto } from './dto/industry-valuation-query.dto'
import { RotationOverviewQueryDto } from './dto/rotation-overview-query.dto'
import { IndustryDetailQueryDto } from './dto/industry-detail-query.dto'
import { RotationHeatmapQueryDto } from './dto/rotation-heatmap-query.dto'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
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
  @ApiOperation({ summary: '获取所有行业在多个时间窗口的累计收益率对比' })
  @ApiSuccessResponse(ReturnComparisonResponseDto)
  getReturnComparison(@Body() query: ReturnComparisonQueryDto) {
    return this.service.getReturnComparison(query)
  }

  @Post('momentum-ranking')
  @ApiOperation({ summary: '基于加权动量评分对行业排名（短/中/长期收益率综合）' })
  @ApiSuccessResponse(MomentumRankingResponseDto)
  getMomentumRanking(@Body() query: MomentumRankingQueryDto) {
    return this.service.getMomentumRanking(query)
  }

  @Post('flow-analysis')
  @ApiOperation({ summary: '分析行业间资金流入流出格局（累计净流入/资金动量/加速度）' })
  @ApiSuccessResponse(FlowAnalysisResponseDto)
  getFlowAnalysis(@Body() query: FlowAnalysisQueryDto) {
    return this.service.getFlowAnalysis(query)
  }

  @Post('valuation')
  @ApiOperation({ summary: '获取行业估值分位（PE/PB 中位数及 1y/3y 历史百分位）' })
  @ApiSuccessResponse(IndustryValuationResponseDto)
  getIndustryValuation(@Body() query: IndustryValuationQueryDto) {
    return this.service.getIndustryValuation(query)
  }

  @Post('overview')
  @ApiOperation({ summary: '行业轮动总览（收益/动量/资金/估值四维度摘要）' })
  @ApiSuccessResponse(RotationOverviewResponseDto)
  getRotationOverview(@Body() query: RotationOverviewQueryDto) {
    return this.service.getRotationOverview(query)
  }

  @Post('detail')
  @ApiOperation({ summary: '单行业详情（收益趋势/资金流趋势/估值快照/成分股）' })
  @ApiSuccessResponse(IndustryDetailResponseDto)
  getIndustryDetail(@Body() query: IndustryDetailQueryDto) {
    return this.service.getIndustryDetail(query)
  }

  @Post('heatmap')
  @ApiOperation({ summary: '行业轮动热力图（行业 × 时间窗口的收益率矩阵）' })
  @ApiSuccessResponse(RotationHeatmapResponseDto)
  getRotationHeatmap(@Body() query: RotationHeatmapQueryDto) {
    return this.service.getRotationHeatmap(query)
  }
}
