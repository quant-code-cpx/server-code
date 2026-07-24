import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AiNotificationChannelType, AiNotificationDeliveryStatus } from '@prisma/client'
import { Transform } from 'class-transformer'
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator'

const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export class CreateNotificationChannelDto {
  @ApiProperty({ enum: AiNotificationChannelType })
  @IsEnum(AiNotificationChannelType)
  type: AiNotificationChannelType

  @ApiProperty({ maxLength: 160, example: '我的站内通知' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name: string

  @ApiPropertyOptional({ format: 'uri', maxLength: 2048, description: '仅 WEBHOOK，必须匹配服务端 HTTPS allowlist' })
  @ValidateIf((dto) => dto.type === AiNotificationChannelType.WEBHOOK)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2_048)
  webhookUrl?: string

  @ApiPropertyOptional({ writeOnly: true, minLength: 16, maxLength: 512, description: '仅 WEBHOOK，创建后不再返回' })
  @ValidateIf((dto) => dto.type === AiNotificationChannelType.WEBHOOK)
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  secret?: string
}

export class NotificationChannelIdDto {
  @ApiProperty()
  @IsString()
  @Matches(ID_PATTERN)
  channelId: string
}

export class UpdateNotificationChannelDto extends NotificationChannelIdDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion: number

  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string

  @ApiPropertyOptional({ description: '启用或停用渠道' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional({ format: 'uri', maxLength: 2048, description: '仅 WEBHOOK；修改后需再次 test 验证' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2_048)
  webhookUrl?: string

  @ApiPropertyOptional({
    writeOnly: true,
    minLength: 16,
    maxLength: 512,
    description: '仅 WEBHOOK；不传则保留当前 secret',
  })
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  secret?: string
}

export class DeleteNotificationChannelDto extends NotificationChannelIdDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion: number
}

export class ListNotificationChannelsDto {
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_dto, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(ID_PATTERN)
  cursor: string | null = null

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30
}

export class ListNotificationDeliveriesDto {
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_dto, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(ID_PATTERN)
  cursor: string | null = null

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30

  @ApiPropertyOptional({ enum: AiNotificationDeliveryStatus })
  @IsOptional()
  @IsEnum(AiNotificationDeliveryStatus)
  status?: AiNotificationDeliveryStatus
}

export class RetryNotificationDeliveryDto {
  @ApiProperty()
  @IsString()
  @Matches(ID_PATTERN)
  deliveryId: string
}
