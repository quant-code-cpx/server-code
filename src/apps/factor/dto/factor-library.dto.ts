import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator'
import { FactorCategory } from '@prisma/client'
import { ApiProperty } from '@nestjs/swagger'

export class FactorLibraryQueryDto {
  @ApiProperty({ enum: FactorCategory, required: false, description: '按分类筛选' })
  @IsOptional()
  @IsEnum(FactorCategory)
  category?: FactorCategory

  @ApiProperty({ required: false, default: true, description: '仅返回已启用的因子' })
  @IsOptional()
  @IsBoolean()
  enabledOnly?: boolean = true
}

export class FactorDetailQueryDto {
  @ApiProperty({ description: '因子名称标识，如 pe_ttm' })
  @IsString()
  @IsNotEmpty()
  factorName: string
}
