import { IsString, IsNotEmpty, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class ChangePasswordDto {
  @ApiProperty({ description: '旧密码' })
  @IsString()
  @IsNotEmpty()
  oldPassword: string

  @ApiProperty({ description: '新密码（至少8位）' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword: string
}
