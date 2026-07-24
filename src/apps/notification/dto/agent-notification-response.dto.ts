import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AiNotificationChannelStatus, AiNotificationChannelType, AiNotificationDeliveryStatus } from '@prisma/client'

export class NotificationChannelResponseDto {
  @ApiProperty() channelId: string
  @ApiProperty({ enum: AiNotificationChannelType }) type: AiNotificationChannelType
  @ApiProperty() name: string
  @ApiProperty({ enum: AiNotificationChannelStatus }) status: AiNotificationChannelStatus
  @ApiProperty() version: number
  @ApiProperty() isVerified: boolean
  @ApiPropertyOptional({ nullable: true }) lastFour: string | null
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) verifiedAt: string | null
  @ApiProperty({ format: 'date-time' }) createdAt: string
  @ApiProperty({ format: 'date-time' }) updatedAt: string
}

export class NotificationChannelListResponseDto {
  @ApiProperty({ type: NotificationChannelResponseDto, isArray: true }) items: NotificationChannelResponseDto[]
  @ApiPropertyOptional({ nullable: true }) nextCursor: string | null
}

export class NotificationChannelTestResponseDto {
  @ApiProperty() channelId: string
  @ApiProperty() verified: boolean
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) verifiedAt: string | null
}

export class NotificationDeliveryResponseDto {
  @ApiProperty() deliveryId: string
  @ApiProperty() channelId: string
  @ApiProperty() channelName: string
  @ApiProperty({ enum: AiNotificationChannelType }) channelType: AiNotificationChannelType
  @ApiPropertyOptional({ nullable: true }) executionId: string | null
  @ApiPropertyOptional({ nullable: true }) runId: string | null
  @ApiProperty({ enum: AiNotificationDeliveryStatus }) status: AiNotificationDeliveryStatus
  @ApiProperty() attempt: number
  @ApiProperty() maxAttempts: number
  @ApiProperty({ format: 'date-time' }) nextAttemptAt: string
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) deliveredAt: string | null
  @ApiPropertyOptional({ nullable: true }) providerMessageId: string | null
  @ApiPropertyOptional({ nullable: true }) errorClass: string | null
  @ApiProperty({ format: 'date-time' }) createdAt: string
}

export class NotificationDeliveryListResponseDto {
  @ApiProperty({ type: NotificationDeliveryResponseDto, isArray: true }) items: NotificationDeliveryResponseDto[]
  @ApiPropertyOptional({ nullable: true }) nextCursor: string | null
}
