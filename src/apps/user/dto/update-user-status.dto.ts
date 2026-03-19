import { IsEnum, IsInt, IsNotEmpty, IsPositive } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { UserStatus } from '@prisma/client'

export class UpdateUserStatusDto {
  @ApiProperty({ example: 1, description: '用户 ID' })
  @IsInt()
  @IsPositive()
  id: number

  @ApiProperty({ enum: [UserStatus.ACTIVE, UserStatus.DEACTIVATED], description: '用户状态' })
  @IsEnum([UserStatus.ACTIVE, UserStatus.DEACTIVATED])
  @IsNotEmpty()
  status: Exclude<UserStatus, 'DELETED'>
}
