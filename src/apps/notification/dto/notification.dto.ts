import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { NotificationType } from '@prisma/client'

export class ListNotificationsDto {
  @ApiPropertyOptional({ description: '页码，从 1 开始', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @ApiPropertyOptional({ description: '每页条数，默认 20，最大 100', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20

  @ApiPropertyOptional({ description: '仅返回未读消息' })
  @IsOptional()
  @Type(() => Boolean)
  unreadOnly?: boolean
}

export class MarkReadDto {
  @ApiProperty({ description: '通知 ID', type: 'integer' })
  @IsInt()
  id: number
}

export class UpdateNotificationPreferenceDto {
  @ApiProperty({ description: '通知类型', enum: NotificationType })
  @IsEnum(NotificationType)
  type: NotificationType

  @ApiProperty({ description: '是否启用该类型通知' })
  @IsBoolean()
  enabled: boolean
}

export class NotificationItemDto {
  @ApiProperty() id: number
  @ApiProperty({ enum: NotificationType }) type: NotificationType
  @ApiProperty() title: string
  @ApiProperty() body: string
  @ApiProperty({ type: 'object', additionalProperties: true }) data: Record<string, unknown>
  @ApiProperty() isRead: boolean
  @ApiProperty({ required: false, nullable: true }) readAt: Date | null
  @ApiProperty() createdAt: Date
}

export class NotificationListDataDto {
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
  @ApiProperty() total: number
  @ApiProperty() unreadCount: number
  @ApiProperty({ type: [NotificationItemDto] }) items: NotificationItemDto[]
}

export class UnreadCountDataDto {
  @ApiProperty() unreadCount: number
}

export class NotificationPreferenceItemDto {
  @ApiProperty({ enum: NotificationType }) type: NotificationType
  @ApiProperty() enabled: boolean
}
