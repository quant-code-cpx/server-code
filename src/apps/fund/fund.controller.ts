import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { FundService } from './fund.service'
import { FundHoldingsQueryDto } from './dto/fund-holdings-query.dto'
import { FundInstitutionalSummaryQueryDto } from './dto/fund-institutional-summary-query.dto'
import { FundEtfFlowQueryDto } from './dto/fund-etf-flow-query.dto'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { FundHoldingItemDto, FundInstitutionalSummaryItemDto, FundEtfFlowItemDto } from './dto/fund-response.dto'

@ApiTags('Fund - 基金')
@Controller('fund')
export class FundController {
  constructor(private readonly fundService: FundService) {}

  @Post('holdings')
  @ApiOperation({ summary: '基金持仓明细（fund_portfolio），缺省取最新报告期' })
  @ApiSuccessResponse(FundHoldingItemDto, { isArray: true })
  getFundHoldings(@Body() query: FundHoldingsQueryDto) {
    return this.fundService.getFundHoldings(query)
  }

  @Post('institutional-summary')
  @ApiOperation({ summary: '机构持仓汇总：按股票聚合公募基金持仓，缺省取最新报告期' })
  @ApiSuccessResponse(FundInstitutionalSummaryItemDto, { isArray: true })
  getInstitutionalSummary(@Body() query: FundInstitutionalSummaryQueryDto) {
    return this.fundService.getInstitutionalSummary(query)
  }

  @Post('etf-flow')
  @ApiOperation({ summary: 'ETF 份额变化与资金流向，缺省最近 7 天' })
  @ApiSuccessResponse(FundEtfFlowItemDto, { isArray: true })
  getEtfFlow(@Body() query: FundEtfFlowQueryDto) {
    return this.fundService.getEtfFlow(query)
  }
}
