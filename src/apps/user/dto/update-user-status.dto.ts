import { IsEnum, IsNotEmpty } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { UserStatus } from '@prisma/client'

export class UpdateUserStatusDto {
  @ApiProperty({ enum: [UserStatus.ACTIVE, UserStatus.DEACTIVATED], description: '用户状态' })
  @IsEnum([UserStatus.ACTIVE, UserStatus.DEACTIVATED])
  @IsNotEmpty()
  status: Exclude<UserStatus, 'DELETED'>
}
