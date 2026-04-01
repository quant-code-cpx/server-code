import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { BacktestRunService } from './services/backtest-run.service'
import { BacktestStrategyRegistryService } from './services/backtest-strategy-registry.service'
import { BacktestDataReadinessService } from './services/backtest-data-readiness.service'
import { CreateBacktestRunDto } from './dto/create-backtest-run.dto'
import { ValidateBacktestRunDto } from './dto/backtest-validate.dto'
import { ListBacktestRunsDto } from './dto/list-backtest-runs.dto'
import { BacktestTradeQueryDto } from './dto/backtest-trade-query.dto'
import { BacktestPositionQueryDto } from './dto/backtest-position-query.dto'
import {
  BacktestEquityResponseDto,
  BacktestPositionResponseDto,
  BacktestRunDetailResponseDto,
  BacktestRunListResponseDto,
  BacktestTradeListResponseDto,
  CancelBacktestRunResponseDto,
  CreateBacktestRunResponseDto,
  StrategyTemplateListResponseDto,
  ValidateBacktestRunResponseDto,
} from './dto/backtest-response.dto'

@ApiTags('Backtest - 策略回测')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('backtests')
export class BacktestController {
  constructor(
    private readonly runService: BacktestRunService,
    private readonly strategyRegistry: BacktestStrategyRegistryService,
    private readonly dataReadinessService: BacktestDataReadinessService,
  ) {}

  @Get('strategy-templates')
  @ApiOperation({ summary: '获取内置策略模板列表' })
  @ApiSuccessResponse(StrategyTemplateListResponseDto)
  getStrategyTemplates() {
    return this.strategyRegistry.getTemplates()
  }

  @Post('runs/validate')
  @ApiOperation({ summary: '验证回测配置合法性和数据完备性' })
  @ApiSuccessResponse(ValidateBacktestRunResponseDto)
  validateRun(@Body() dto: ValidateBacktestRunDto) {
    return this.dataReadinessService.checkReadiness(dto)
  }

  @Post('runs')
  @ApiOperation({ summary: '创建回测任务' })
  @ApiSuccessResponse(CreateBacktestRunResponseDto)
  createRun(@Body() dto: CreateBacktestRunDto, @CurrentUser() user: TokenPayload) {
    return this.runService.createRun(dto, user.id)
  }

  @Get('runs')
  @ApiOperation({ summary: '查询回测历史列表' })
  @ApiSuccessResponse(BacktestRunListResponseDto)
  listRuns(@Query() dto: ListBacktestRunsDto, @CurrentUser() user: TokenPayload) {
    return this.runService.listRuns(dto, user.id)
  }

  @Get('runs/:runId')
  @ApiOperation({ summary: '获取回测详情' })
  @ApiSuccessResponse(BacktestRunDetailResponseDto)
  getRunDetail(@Param('runId') runId: string) {
    return this.runService.getRunDetail(runId)
  }

  @Get('runs/:runId/equity')
  @ApiOperation({ summary: '获取日度净值曲线' })
  @ApiSuccessResponse(BacktestEquityResponseDto)
  getEquity(@Param('runId') runId: string) {
    return this.runService.getEquity(runId)
  }

  @Get('runs/:runId/trades')
  @ApiOperation({ summary: '分页查询交易明细' })
  @ApiSuccessResponse(BacktestTradeListResponseDto)
  getTrades(@Param('runId') runId: string, @Query() dto: BacktestTradeQueryDto) {
    return this.runService.getTrades(runId, dto)
  }

  @Get('runs/:runId/positions')
  @ApiOperation({ summary: '查询持仓快照' })
  @ApiSuccessResponse(BacktestPositionResponseDto)
  getPositions(@Param('runId') runId: string, @Query() dto: BacktestPositionQueryDto) {
    return this.runService.getPositions(runId, dto)
  }

  @Post('runs/:runId/cancel')
  @ApiOperation({ summary: '取消回测任务' })
  @ApiSuccessResponse(CancelBacktestRunResponseDto)
  cancelRun(@Param('runId') runId: string) {
    return this.runService.cancelRun(runId)
  }
}
