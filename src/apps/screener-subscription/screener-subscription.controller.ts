import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { ScreenerSubscriptionService } from './screener-subscription.service'
import {
  CreateSubscriptionDto,
  SubscriptionIdDto,
  SubscriptionHitsDto,
  SubscriptionLogsBodyDto,
  SubscriptionMetricsDto,
  SubscriptionRunStatusDto,
  PreviewSubscriptionDto,
  UpdateSubscriptionBodyDto,
  ValidateSubscriptionDto,
} from './dto/subscription.dto'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import {
  ManualRunResponseDto,
  PreviewSubscriptionResponseDto,
  SubscriptionDto,
  SubscriptionHitListResponseDto,
  SubscriptionListResponseDto,
  SubscriptionLogListResponseDto,
  SubscriptionMessageResponseDto,
  SubscriptionMetricsResponseDto,
  SubscriptionRunStatusResponseDto,
  ValidateSubscriptionResponseDto,
} from './dto/subscription-response.dto'

@ApiTags('ScreenerSubscription - 条件订阅')
@UseGuards(JwtAuthGuard)
@Controller('screener-subscription')
export class ScreenerSubscriptionController {
  constructor(private readonly subscriptionService: ScreenerSubscriptionService) {}

  @Post('list')
  @ApiOperation({ summary: '获取用户所有条件订阅' })
  @ApiSuccessResponse(SubscriptionListResponseDto)
  findAll(@CurrentUser() user: TokenPayload) {
    return this.subscriptionService.findAll(user.id)
  }

  @Post('detail')
  @ApiOperation({ summary: '获取单条订阅详情' })
  @ApiSuccessResponse(SubscriptionDto)
  detail(@CurrentUser() user: TokenPayload, @Body() { id }: SubscriptionIdDto) {
    return this.subscriptionService.detail(user.id, id)
  }

  @Post('create')
  @ApiOperation({ summary: '创建条件订阅' })
  @ApiSuccessResponse(SubscriptionDto)
  create(@CurrentUser() user: TokenPayload, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptionService.create(user.id, dto)
  }

  @Post('update')
  @ApiOperation({ summary: '更新条件订阅（名称/频率/条件/策略）' })
  @ApiSuccessResponse(SubscriptionDto)
  update(@CurrentUser() user: TokenPayload, @Body() dto: UpdateSubscriptionBodyDto) {
    return this.subscriptionService.update(user.id, dto.id, dto)
  }

  @Post('delete')
  @ApiOperation({ summary: '删除条件订阅' })
  @ApiSuccessResponse(SubscriptionMessageResponseDto)
  remove(@CurrentUser() user: TokenPayload, @Body() { id }: SubscriptionIdDto) {
    return this.subscriptionService.remove(user.id, id)
  }

  @Post('pause')
  @ApiOperation({ summary: '暂停订阅' })
  @ApiSuccessResponse(SubscriptionDto)
  pause(@CurrentUser() user: TokenPayload, @Body() { id }: SubscriptionIdDto) {
    return this.subscriptionService.pause(user.id, id)
  }

  @Post('resume')
  @ApiOperation({ summary: '恢复订阅' })
  @ApiSuccessResponse(SubscriptionDto)
  resume(@CurrentUser() user: TokenPayload, @Body() { id }: SubscriptionIdDto) {
    return this.subscriptionService.resume(user.id, id)
  }

  @Post('run')
  @ApiOperation({ summary: '手动触发一次订阅执行' })
  @ApiSuccessResponse(ManualRunResponseDto)
  manualRun(@CurrentUser() user: TokenPayload, @Body() { id }: SubscriptionIdDto) {
    return this.subscriptionService.manualRun(user.id, id)
  }

  @Post('logs')
  @ApiOperation({ summary: '获取订阅执行日志（含股票元数据）' })
  @ApiSuccessResponse(SubscriptionLogListResponseDto)
  getLogs(@CurrentUser() user: TokenPayload, @Body() dto: SubscriptionLogsBodyDto) {
    return this.subscriptionService.getLogs(user.id, dto.id, dto)
  }

  @Post('validate')
  @ApiOperation({ summary: '检测是否存在重复/相似订阅' })
  @ApiSuccessResponse(ValidateSubscriptionResponseDto)
  validate(@CurrentUser() user: TokenPayload, @Body() dto: ValidateSubscriptionDto) {
    return this.subscriptionService.validate(user.id, dto)
  }

  @Post('metrics')
  @ApiOperation({ summary: '获取条件订阅规则指标目录' })
  @ApiSuccessResponse(SubscriptionMetricsResponseDto)
  metrics(@CurrentUser() user: TokenPayload, @Body() dto: SubscriptionMetricsDto) {
    return this.subscriptionService.metrics(user.id, dto)
  }

  @Post('preview')
  @ApiOperation({ summary: '预览规则命中集合，不写订阅状态也不发送通知' })
  @ApiSuccessResponse(PreviewSubscriptionResponseDto)
  preview(@CurrentUser() user: TokenPayload, @Body() dto: PreviewSubscriptionDto) {
    return this.subscriptionService.preview(user.id, dto)
  }

  @Post('hits')
  @ApiOperation({ summary: '查询单次运行的命中证据' })
  @ApiSuccessResponse(SubscriptionHitListResponseDto)
  hits(@CurrentUser() user: TokenPayload, @Body() dto: SubscriptionHitsDto) {
    return this.subscriptionService.getHits(user.id, dto)
  }

  @Post('run/status')
  @ApiOperation({ summary: '查询手动运行状态' })
  @ApiSuccessResponse(SubscriptionRunStatusResponseDto)
  runStatus(@CurrentUser() user: TokenPayload, @Body() dto: SubscriptionRunStatusDto) {
    return this.subscriptionService.getRunStatus(user.id, dto.jobId)
  }
}
