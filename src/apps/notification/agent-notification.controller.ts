import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AgentErrorInterceptor } from 'src/apps/agent/api/agent-error.interceptor'
import { AgentStrictBodyGuard } from 'src/apps/agent/api/agent-strict-body.guard'
import { StrictAgentBody } from 'src/apps/agent/api/strict-agent-body.decorator'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import type { TokenPayload } from 'src/shared/token.interface'
import {
  CreateNotificationChannelDto,
  DeleteNotificationChannelDto,
  ListNotificationChannelsDto,
  ListNotificationDeliveriesDto,
  NotificationChannelIdDto,
  RetryNotificationDeliveryDto,
  UpdateNotificationChannelDto,
} from './dto/agent-notification-request.dto'
import {
  NotificationChannelListResponseDto,
  NotificationChannelResponseDto,
  NotificationChannelTestResponseDto,
  NotificationDeliveryListResponseDto,
  NotificationDeliveryResponseDto,
} from './dto/agent-notification-response.dto'
import { NotificationChannelService } from './notification-channel.service'
import { NotificationDeliveryService } from './notification-delivery.service'

@ApiTags('Agent - 通知渠道')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AgentStrictBodyGuard)
@UseInterceptors(AgentErrorInterceptor)
@Controller('agent/notification-channels')
export class AgentNotificationChannelController {
  constructor(private readonly channels: NotificationChannelService) {}

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListNotificationChannelsDto)
  @ApiOperation({ summary: '分页查询当前用户的 Agent 通知渠道，永不返回 secret' })
  @ApiSuccessResponse(NotificationChannelListResponseDto)
  list(@CurrentUser() user: TokenPayload, @Body() dto: ListNotificationChannelsDto) {
    return this.channels.list(user.id, dto)
  }

  @Post('create')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(CreateNotificationChannelDto)
  @ApiOperation({ summary: '创建站内或签名 HTTPS Webhook 通知渠道' })
  @ApiSuccessResponse(NotificationChannelResponseDto)
  create(@CurrentUser() user: TokenPayload, @Body() dto: CreateNotificationChannelDto) {
    return this.channels.create(user.id, dto)
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(UpdateNotificationChannelDto)
  @ApiOperation({ summary: 'CAS 更新通知渠道；修改 Webhook 配置后需重新测试验证' })
  @ApiSuccessResponse(NotificationChannelResponseDto)
  update(@CurrentUser() user: TokenPayload, @Body() dto: UpdateNotificationChannelDto) {
    return this.channels.update(user.id, dto)
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(NotificationChannelIdDto)
  @ApiOperation({ summary: '向当前用户自有渠道发送安全测试消息并更新验证状态' })
  @ApiSuccessResponse(NotificationChannelTestResponseDto)
  test(@CurrentUser() user: TokenPayload, @Body() dto: NotificationChannelIdDto) {
    return this.channels.test(user.id, dto.channelId)
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(DeleteNotificationChannelDto)
  @ApiOperation({ summary: '软删除通知渠道，保留历史 delivery 审计' })
  @ApiSuccessResponse(NotificationChannelResponseDto)
  delete(@CurrentUser() user: TokenPayload, @Body() dto: DeleteNotificationChannelDto) {
    return this.channels.delete(user.id, dto.channelId, dto.expectedVersion)
  }
}

@ApiTags('Agent - 通知投递')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AgentStrictBodyGuard)
@UseInterceptors(AgentErrorInterceptor)
@Controller('agent/notification-deliveries')
export class AgentNotificationDeliveryController {
  constructor(private readonly deliveries: NotificationDeliveryService) {}

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListNotificationDeliveriesDto)
  @ApiOperation({ summary: '分页查询当前用户的 Agent 通知投递历史' })
  @ApiSuccessResponse(NotificationDeliveryListResponseDto)
  list(@CurrentUser() user: TokenPayload, @Body() dto: ListNotificationDeliveriesDto) {
    return this.deliveries.list(user.id, dto)
  }

  @Post('retry')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(RetryNotificationDeliveryDto)
  @ApiOperation({ summary: '仅重试指定 delivery，不重跑 Agent Run 或研究任务' })
  @ApiSuccessResponse(NotificationDeliveryResponseDto)
  async retry(@CurrentUser() user: TokenPayload, @Body() dto: RetryNotificationDeliveryDto) {
    const delivery = await this.deliveries.retry(user.id, dto.deliveryId)
    return {
      deliveryId: delivery.id,
      channelId: delivery.channelId,
      channelName: delivery.channel.name,
      channelType: delivery.channel.type,
      executionId: delivery.executionId,
      runId: delivery.runId,
      status: delivery.status,
      attempt: delivery.attempt,
      maxAttempts: delivery.maxAttempts,
      nextAttemptAt: delivery.nextAttemptAt.toISOString(),
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      providerMessageId: delivery.providerMessageId,
      errorClass: delivery.errorClass,
      createdAt: delivery.createdAt.toISOString(),
    }
  }
}
