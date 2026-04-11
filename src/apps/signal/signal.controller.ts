import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { SignalService } from './signal.service'
import {
  ActivateSignalDto,
  DeactivateSignalDto,
  LatestSignalQueryDto,
  LatestSignalResponseDto,
  SignalActivationItemDto,
  SignalHistoryQueryDto,
  SignalHistoryResponseDto,
} from './dto/signal.dto'

@ApiTags('信号引擎')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('signal')
export class SignalController {
  constructor(private readonly signalService: SignalService) {}

  @Post('strategies/activate')
  @ApiOperation({ summary: '激活策略的每日信号生成' })
  @ApiSuccessResponse(SignalActivationItemDto)
  activate(@CurrentUser() user: TokenPayload, @Body() dto: ActivateSignalDto) {
    return this.signalService.activate(dto, user.id)
  }

  @Post('strategies/deactivate')
  @ApiOperation({ summary: '停用策略信号生成' })
  @ApiSuccessResponse(SignalActivationItemDto)
  deactivate(@CurrentUser() user: TokenPayload, @Body() dto: DeactivateSignalDto) {
    return this.signalService.deactivate(dto, user.id)
  }

  @Post('strategies/list')
  @ApiOperation({ summary: '查询已激活策略列表' })
  @ApiSuccessResponse(SignalActivationItemDto, { isArray: true })
  listActivations(@CurrentUser() user: TokenPayload) {
    return this.signalService.listActivations(user.id)
  }

  @Post('latest')
  @ApiOperation({ summary: '查询最新信号（按策略、日期筛选）' })
  @ApiSuccessResponse(LatestSignalResponseDto, { isArray: true })
  getLatestSignals(@CurrentUser() user: TokenPayload, @Body() dto: LatestSignalQueryDto) {
    return this.signalService.getLatestSignals(dto, user.id)
  }

  @Post('history')
  @ApiOperation({ summary: '查询信号历史（分页）' })
  @ApiSuccessResponse(SignalHistoryResponseDto)
  getSignalHistory(@CurrentUser() user: TokenPayload, @Body() dto: SignalHistoryQueryDto) {
    return this.signalService.getSignalHistory(dto, user.id)
  }
}
