import { AuditAction } from '@prisma/client'
import { ApiProperty } from '@nestjs/swagger'

export class AuditLogItemDto {
  @ApiProperty() id: number
  @ApiProperty() operatorId: number
  @ApiProperty() operatorAccount: string
  @ApiProperty({ enum: AuditAction }) action: AuditAction
  @ApiProperty({ required: false, nullable: true }) targetId: number | null
  @ApiProperty({ required: false, nullable: true }) targetAccount: string | null
  @ApiProperty({ required: false, nullable: true }) details: Record<string, unknown> | null
  @ApiProperty({ required: false, nullable: true }) ipAddress: string | null
  @ApiProperty() createdAt: Date
}

export class AuditLogListDataDto {
  @ApiProperty() total: number
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
  @ApiProperty({ type: [AuditLogItemDto] }) items: AuditLogItemDto[]
}
