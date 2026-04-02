import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { FactorCategory } from '@prisma/client'
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator'

export class CreateCustomFactorDto {
  @ApiProperty({
    description: '因子英文标识（小写字母开头，仅允许小写字母/数字/下划线）',
    example: 'my_momentum',
  })
  @IsString()
  @Length(2, 50)
  @Matches(/^[a-z][a-z0-9_]*$/, { message: '因子名只能包含小写字母、数字和下划线，且以字母开头' })
  name: string

  @ApiProperty({ description: '因子中文名', example: '自定义动量因子' })
  @IsString()
  @Length(1, 50)
  label: string

  @ApiPropertyOptional({ description: '因子说明', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @ApiProperty({ description: '因子分类', enum: FactorCategory })
  @IsEnum(FactorCategory)
  category: FactorCategory

  @ApiProperty({
    description: '因子表达式（最大 500 字符）',
    example: 'rank(close / delay(close, 20))',
  })
  @IsString()
  @MaxLength(500)
  expression: string

  @ApiPropertyOptional({ description: '是否加入每日自动预计算（默认 false）', default: false })
  @IsOptional()
  @IsBoolean()
  autoPrecompute?: boolean
}

export class UpdateCustomFactorDto {
  @ApiPropertyOptional({ description: '因子中文名' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  label?: string

  @ApiPropertyOptional({ description: '因子说明', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string

  @ApiPropertyOptional({ description: '因子分类', enum: FactorCategory })
  @IsOptional()
  @IsEnum(FactorCategory)
  category?: FactorCategory

  @ApiPropertyOptional({ description: '因子表达式', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  expression?: string

  @ApiPropertyOptional({ description: '是否加入每日自动预计算' })
  @IsOptional()
  @IsBoolean()
  autoPrecompute?: boolean

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean
}

export class TestCustomFactorDto {
  @ApiProperty({
    description: '因子表达式（最大 500 字符）',
    example: 'rank(close / delay(close, 20))',
  })
  @IsString()
  @MaxLength(500)
  expression: string

  @ApiProperty({ description: '试算日期 YYYYMMDD', example: '20260327' })
  @IsString()
  @Matches(/^\d{8}$/, { message: '日期格式必须为 YYYYMMDD' })
  tradeDate: string

  @ApiPropertyOptional({ description: '股票池（如 000300.SH）' })
  @IsOptional()
  @IsString()
  universe?: string
}
