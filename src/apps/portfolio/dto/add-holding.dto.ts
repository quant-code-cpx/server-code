import { IsInt, IsNumber, IsOptional, IsString, Length, Matches, Min } from 'class-validator'

export class AddHoldingDto {
  @IsString()
  portfolioId: string

  @IsString()
  @Matches(/^\d{6}\.[A-Z]{2}$/, { message: '股票代码格式错误，应为 6位数字.2位大写字母，如 000001.SZ' })
  tsCode: string

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
