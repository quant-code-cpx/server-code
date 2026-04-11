import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class CreatePortfolioDto {
  @IsString()
  @MaxLength(100)
  name: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @IsNumber()
  @Min(0)
  initialCash: number
}
