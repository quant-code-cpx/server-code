import { ApiProperty } from '@nestjs/swagger'

export class HeatmapItemDto {
  @ApiProperty() tsCode: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ required: false, nullable: true }) industry: string | null
  @ApiProperty({ required: false, nullable: true }) pctChg: number | null
  @ApiProperty({ required: false, nullable: true }) totalMv: number | null
}
