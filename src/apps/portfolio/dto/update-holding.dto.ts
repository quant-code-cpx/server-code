import { IsInt, IsNumber, IsOptional, IsString, Length, Matches, Min } from 'class-validator'

export class UpdateHoldingDto {
  @IsString()
  holdingId: string

  @IsInt()
  @Min(1)
  quantity: number

  @IsNumber()
  @Min(0)
  avgCost: number

  @IsString()
  @Length(8, 128)
  idempotencyKey: string

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveDate?: string
}

export class RemoveHoldingDto {
  @IsString()
  holdingId: string

  @IsString()
  @Length(8, 128)
  idempotencyKey: string

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveDate?: string
}
