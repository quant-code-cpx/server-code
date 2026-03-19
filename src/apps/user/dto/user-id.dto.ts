import { IsInt, IsPositive } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class UserIdDto {
  @ApiProperty({ example: 1, description: '用户 ID' })
  @IsInt()
  @IsPositive()
  id: number
}
