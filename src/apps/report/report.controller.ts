import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { TokenPayload } from 'src/shared/token.interface'
import {
  CreateBacktestReportDto,
  CreatePortfolioReportDto,
  CreateStockReportDto,
  CreateStrategyResearchReportDto,
  QueryReportsDto,
} from './dto/create-report.dto'
import { ReportService } from './report.service'

@ApiTags('量化报告')
@UseGuards(JwtAuthGuard)
@Controller('report')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post('backtest')
  @ApiOperation({ summary: '生成回测报告' })
  createBacktestReport(@CurrentUser() user: TokenPayload, @Body() dto: CreateBacktestReportDto) {
    return this.reportService.createBacktestReport(dto, user.id)
  }

  @Post('stock')
  @ApiOperation({ summary: '生成个股研报' })
  createStockReport(@CurrentUser() user: TokenPayload, @Body() dto: CreateStockReportDto) {
    return this.reportService.createStockReport(dto, user.id)
  }

  @Post('portfolio')
  @ApiOperation({ summary: '生成组合分析报告' })
  createPortfolioReport(@CurrentUser() user: TokenPayload, @Body() dto: CreatePortfolioReportDto) {
    return this.reportService.createPortfolioReport(dto, user.id)
  }

  @Post('strategy-research')
  @ApiOperation({ summary: '生成策略研究报告（回测+持仓+交易日志综合）' })
  createStrategyResearchReport(@CurrentUser() user: TokenPayload, @Body() dto: CreateStrategyResearchReportDto) {
    return this.reportService.createStrategyResearchReport(dto, user.id)
  }

  @Post('list')
  @ApiOperation({ summary: '查询报告列表' })
  queryReports(@CurrentUser() user: TokenPayload, @Body() dto: QueryReportsDto) {
    return this.reportService.queryReports(dto, user.id)
  }

  @Post('detail')
  @ApiOperation({ summary: '获取报告详情' })
  getReportDetail(@CurrentUser() user: TokenPayload, @Body() body: { reportId: string }) {
    return this.reportService.getReportDetail(body.reportId, user.id)
  }

  @Post('delete')
  @ApiOperation({ summary: '删除报告' })
  deleteReport(@CurrentUser() user: TokenPayload, @Body() body: { reportId: string }) {
    return this.reportService.deleteReport(body.reportId, user.id)
  }
}
