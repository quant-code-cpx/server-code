import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiSuccessResponse, ApiSuccessRawResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { NotificationService } from './notification.service'
import {
  ListNotificationsDto,
  MarkReadDto,
  UpdateNotificationPreferenceDto,
  NotificationListDataDto,
  NotificationPreferenceItemDto,
  UnreadCountDataDto,
} from './dto/notification.dto'

@ApiBearerAuth()
@ApiTags('Notification - 站内消息')
@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('list')
  @ApiOperation({ summary: '获取当前用户的通知列表（分页，支持仅显示未读）' })
  @ApiSuccessResponse(NotificationListDataDto)
  list(@CurrentUser() user: TokenPayload, @Body() dto: ListNotificationsDto) {
    return this.notificationService.list(user.id, dto)
  }

  @Post('unread-count')
  @ApiOperation({ summary: '获取当前用户未读通知数' })
  @ApiSuccessResponse(UnreadCountDataDto)
  unreadCount(@CurrentUser() user: TokenPayload) {
    return this.notificationService.getUnreadCount(user.id)
  }

  @Post('mark-read')
  @ApiOperation({ summary: '标记指定通知为已读' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async markRead(@CurrentUser() user: TokenPayload, @Body() dto: MarkReadDto) {
    await this.notificationService.markRead(user.id, dto.id)
    return null
  }

  @Post('mark-all-read')
  @ApiOperation({ summary: '标记所有通知为已读' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async markAllRead(@CurrentUser() user: TokenPayload) {
    await this.notificationService.markAllRead(user.id)
    return null
  }

  @Post('delete')
  @ApiOperation({ summary: '删除指定通知' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async deleteNotification(@CurrentUser() user: TokenPayload, @Body() dto: MarkReadDto) {
    await this.notificationService.deleteNotification(user.id, dto.id)
    return null
  }

  @Post('preferences')
  @ApiOperation({ summary: '获取当前用户通知偏好设置列表' })
  @ApiSuccessResponse(NotificationPreferenceItemDto, { isArray: true })
  getPreferences(@CurrentUser() user: TokenPayload) {
    return this.notificationService.getPreferences(user.id)
  }

  @Post('preferences/update')
  @ApiOperation({ summary: '更新通知偏好（按类型开关）' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async updatePreference(@CurrentUser() user: TokenPayload, @Body() dto: UpdateNotificationPreferenceDto) {
    await this.notificationService.updatePreference(user.id, dto)
    return null
  }
}
