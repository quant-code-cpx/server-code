import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { Type } from 'class-transformer'

export class UpdateRoleDto {
  @ApiProperty({ description: '目标用户 ID' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id: number

  @ApiProperty({ enum: UserRole, description: '新角色（不可设为 SUPER_ADMIN）' })
  @IsEnum(UserRole)
  role: UserRole

  @ApiPropertyOptional({ description: '变更原因（写入审计日志）', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  reason?: string
}
