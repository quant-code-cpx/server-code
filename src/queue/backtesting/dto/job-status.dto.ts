import { IsNotEmpty, IsString } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class JobStatusDto {
  @ApiProperty({ example: 'abc123', description: '回测任务 ID' })
  @IsString()
  @IsNotEmpty()
  jobId: string
}
