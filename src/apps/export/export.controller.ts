import { Controller, Post, Body, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Response } from 'express'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { ApiSuccessRawResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { ExportService } from './export.service'
import {
  ExportAlertAnomaliesDto,
  ExportBacktestTradesDto,
  ExportFactorScreeningDto,
  ExportFactorValuesDto,
  ExportPortfolioHoldingsDto,
  ExportStockListDto,
} from './dto/export.dto'

@ApiTags('export')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post('backtest-trades')
  @ApiOperation({ summary: '导出回测交易明细 CSV' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async exportBacktestTrades(
    @Body() dto: ExportBacktestTradesDto,
    @CurrentUser() user: TokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, csv } = await this.exportService.exportBacktestTrades(dto.runId, user.id)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return csv
  }

  @Post('factor-values')
  @ApiOperation({ summary: '导出因子快照数据 CSV' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async exportFactorValues(
    @Body() dto: ExportFactorValuesDto,
    @CurrentUser() user: TokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, csv } = await this.exportService.exportFactorValues({
      factorId: dto.factorId,
      userId: user.id,
      startDate: dto.startDate,
      endDate: dto.endDate,
    })
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return csv
  }

  @Post('portfolio-holdings')
  @ApiOperation({ summary: '导出投资组合持仓 CSV' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async exportPortfolioHoldings(
    @Body() dto: ExportPortfolioHoldingsDto,
    @CurrentUser() user: TokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, csv } = await this.exportService.exportPortfolioHoldings(dto.portfolioId, user.id)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return csv
  }

  @Post('stock-list')
  @ApiOperation({ summary: '导出股票列表 CSV（支持筛选条件 + 自定义列）' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async exportStockList(@Body() dto: ExportStockListDto, @Res({ passthrough: true }) res: Response) {
    const { filename, csv } = await this.exportService.exportStockList(dto)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    return csv
  }

  @Post('alert-anomalies')
  @ApiOperation({ summary: '导出异动监控记录 CSV（可指定交易日，不传则取最新）' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async exportAlertAnomalies(@Body() dto: ExportAlertAnomaliesDto, @Res({ passthrough: true }) res: Response) {
    const { filename, csv } = await this.exportService.exportAlertAnomalies(dto)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    return csv
  }

  @Post('factor-screening')
  @ApiOperation({ summary: '导出多因子筛选结果 CSV（支持自定义列）' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async exportFactorScreening(@Body() dto: ExportFactorScreeningDto, @Res({ passthrough: true }) res: Response) {
    const { filename, csv } = await this.exportService.exportFactorScreening(dto)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    return csv
  }
}
