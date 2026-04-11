import { IsArray, IsEnum, IsOptional, IsString, Matches } from 'class-validator'
import { Transform } from 'class-transformer'

export enum CalendarEventType {
  DISCLOSURE = 'DISCLOSURE',
  FLOAT = 'FLOAT',
  DIVIDEND = 'DIVIDEND',
  FORECAST = 'FORECAST',
}

export class CalendarQueryDto {
  @Matches(/^\d{8}$/, { message: 'startDate 格式应为 YYYYMMDD' })
  startDate: string

  @Matches(/^\d{8}$/, { message: 'endDate 格式应为 YYYYMMDD' })
  endDate: string

  @IsOptional()
  @IsString()
  tsCode?: string

  @IsOptional()
  @IsArray()
  @IsEnum(CalendarEventType, { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  types?: CalendarEventType[]
}
