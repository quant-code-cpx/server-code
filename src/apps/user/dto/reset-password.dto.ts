import { IsInt, IsNotEmpty, IsPositive, IsString, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class ResetPasswordDto {
  @ApiProperty({ example: 1, description: '用户 ID' })
  @IsInt()
  @IsPositive()
  id: number

  @ApiProperty({ example: 'NewPass88', description: '新密码（至少8位）' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string
}
