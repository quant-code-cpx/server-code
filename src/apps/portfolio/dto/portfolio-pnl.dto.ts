import { IsString, Matches } from 'class-validator'

export class PortfolioPnlHistoryDto {
  @IsString()
  portfolioId: string

  @IsString()
  @Matches(/^\d{8}$/, { message: '日期格式错误，应为 YYYYMMDD' })
  startDate: string

  @IsString()
  @Matches(/^\d{8}$/, { message: '日期格式错误，应为 YYYYMMDD' })
  endDate: string
}
