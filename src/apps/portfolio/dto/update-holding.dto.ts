import { IsInt, IsNumber, IsString, Min } from 'class-validator'

export class UpdateHoldingDto {
  @IsString()
  holdingId: string

  @IsInt()
  @Min(1)
  quantity: number

  @IsNumber()
  @Min(0)
  avgCost: number
}
