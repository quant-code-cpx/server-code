import { ApiProperty } from '@nestjs/swagger'

export class MarketMoneyFlowItemDto {
  @ApiProperty() tradeDate: Date
  @ApiProperty({ required: false, nullable: true }) netAmount: number | null
  @ApiProperty({ required: false, nullable: true }) buyAmount: number | null
  @ApiProperty({ required: false, nullable: true }) sellAmount: number | null
}

export class SectorFlowItemDto {
  @ApiProperty() tradeDate: Date
  @ApiProperty() contentType: string
  @ApiProperty({ required: false, nullable: true }) name: string | null
  @ApiProperty({ required: false, nullable: true }) netAmount: number | null
  @ApiProperty({ required: false, nullable: true }) rank: number | null
}

export class SectorFlowDataDto {
  @ApiProperty({ required: false, nullable: true }) tradeDate: Date | null
  @ApiProperty({ type: [SectorFlowItemDto] }) industry: SectorFlowItemDto[]
  @ApiProperty({ type: [SectorFlowItemDto] }) concept: SectorFlowItemDto[]
  @ApiProperty({ type: [SectorFlowItemDto] }) region: SectorFlowItemDto[]
}
