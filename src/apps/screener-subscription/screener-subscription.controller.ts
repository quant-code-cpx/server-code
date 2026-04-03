import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { ScreenerSubscriptionService } from './screener-subscription.service'
import { CreateSubscriptionDto, SubscriptionLogsQueryDto, UpdateSubscriptionDto } from './dto/subscription.dto'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import {
  ManualRunResponseDto,
  SubscriptionDto,
  SubscriptionListResponseDto,
  SubscriptionLogListResponseDto,
  SubscriptionMessageResponseDto,
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

  @Post('create')
  @ApiOperation({ summary: '创建条件订阅' })
  @ApiSuccessResponse(SubscriptionDto)
  create(@CurrentUser() user: TokenPayload, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptionService.create(user.id, dto)
  }

  @Post('update')
  @ApiOperation({ summary: '更新条件订阅（名称/频率）' })
  @ApiSuccessResponse(SubscriptionDto)
  update(@CurrentUser() user: TokenPayload, @Body() dto: UpdateSubscriptionDto & { id: number }) {
    return this.subscriptionService.update(user.id, dto.id, dto)
  }

  @Post('delete')
  @ApiOperation({ summary: '删除条件订阅' })
  @ApiSuccessResponse(SubscriptionMessageResponseDto)
  remove(@CurrentUser() user: TokenPayload, @Body() { id }: { id: number }) {
    return this.subscriptionService.remove(user.id, id)
  }

  @Post('pause')
  @ApiOperation({ summary: '暂停订阅' })
  @ApiSuccessResponse(SubscriptionMessageResponseDto)
  pause(@CurrentUser() user: TokenPayload, @Body() { id }: { id: number }) {
    return this.subscriptionService.pause(user.id, id)
  }

  @Post('resume')
  @ApiOperation({ summary: '恢复订阅' })
  @ApiSuccessResponse(SubscriptionMessageResponseDto)
  resume(@CurrentUser() user: TokenPayload, @Body() { id }: { id: number }) {
    return this.subscriptionService.resume(user.id, id)
  }

  @Post('run')
  @ApiOperation({ summary: '手动触发一次订阅执行' })
  @ApiSuccessResponse(ManualRunResponseDto)
  manualRun(@CurrentUser() user: TokenPayload, @Body() { id }: { id: number }) {
    return this.subscriptionService.manualRun(user.id, id)
  }

  @Post('logs')
  @ApiOperation({ summary: '获取订阅执行日志' })
  @ApiSuccessResponse(SubscriptionLogListResponseDto)
  getLogs(@CurrentUser() user: TokenPayload, @Body() dto: SubscriptionLogsQueryDto & { id: number }) {
    return this.subscriptionService.getLogs(user.id, dto.id, dto)
  }
}
