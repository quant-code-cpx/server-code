import { Controller, Post, Body, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Response } from 'express'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { ApiSuccessRawResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { ExportService } from './export.service'
import {
  ExportBacktestTradesDto,
  ExportFactorValuesDto,
  ExportPortfolioHoldingsDto,
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
}
