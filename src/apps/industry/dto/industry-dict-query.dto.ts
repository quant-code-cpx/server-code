import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsOptional } from 'class-validator'
import { Type } from 'class-transformer'

export class IndustryDictMappingQueryDto {
  @ApiPropertyOptional({
    description: '源字典：sw_l1（申万一级行业）',
    enum: ['sw_l1'],
    default: 'sw_l1',
  })
  @IsOptional()
  @IsIn(['sw_l1'])
  source?: 'sw_l1' = 'sw_l1'

  @ApiPropertyOptional({
    description: '目标字典：dc_industry（东财行业板块）',
    enum: ['dc_industry'],
    default: 'dc_industry',
  })
  @IsOptional()
  @IsIn(['dc_industry'])
  target?: 'dc_industry' = 'dc_industry'

  @ApiPropertyOptional({
    description: '是否返回未匹配的申万行业',
    default: true,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeUnmatched?: boolean = true
}
