import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

// ── Watchlist CRUD ───────────────────────────────────────────────────────────

export class CreateWatchlistDto {
  @ApiProperty({ description: '自选组名称', maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string

  @ApiPropertyOptional({ description: '描述', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string

  @ApiPropertyOptional({ description: '是否设为默认自选组' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean
}

export class UpdateWatchlistDto {
  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number
}

// ── Stock members ────────────────────────────────────────────────────────────

export class AddWatchlistStockDto {
  @ApiProperty({ description: '股票代码，如 000001.SZ', example: '000001.SZ' })
  @IsString()
  @Matches(/^\d{6}\.(SH|SZ|BJ)$/, { message: 'tsCode 格式应为 000001.SZ/SH/BJ' })
  tsCode: string

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @ArrayMaxSize(10)
  tags?: string[]

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetPrice?: number
}

export class UpdateWatchlistStockDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  @ArrayMaxSize(10)
  tags?: string[]

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetPrice?: number
}

export class BatchAddStocksDto {
  @ApiProperty({ type: [AddWatchlistStockDto], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AddWatchlistStockDto)
  stocks: AddWatchlistStockDto[]
}

export class BatchRemoveStocksDto {
  @ApiProperty({ type: [Number], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  stockIds: number[]
}

// ── Reorder ──────────────────────────────────────────────────────────────────

class ReorderItem {
  @ApiProperty()
  @IsInt()
  id: number

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  sortOrder: number
}

export class ReorderWatchlistsDto {
  @ApiProperty({ type: [ReorderItem] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderItem)
  items: ReorderItem[]
}
