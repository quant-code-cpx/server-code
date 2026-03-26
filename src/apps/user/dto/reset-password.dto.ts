import { IsInt, IsOptional, IsPositive, IsString, MinLength } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class ResetPasswordDto {
  @ApiProperty({ example: 1, description: '用户 ID' })
  @IsInt()
  @IsPositive()
  id: number

  @ApiPropertyOptional({ example: 'NewPass88', description: '新密码（至少8位，不传则自动生成随机密码）' })
  @IsString()
  @MinLength(8)
  @IsOptional()
  newPassword?: string
}
