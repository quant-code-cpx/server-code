import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { AiResearchReportStatus } from '@prisma/client'

export class ResearchReportCitationDto {
  @ApiProperty() citationId: string
  @ApiProperty() blockId: string
  @ApiProperty() claimKey: string
  @ApiProperty() title: string
  @ApiPropertyOptional({ nullable: true }) canonicalUrl: string | null
  @ApiProperty({ format: 'date-time' }) retrievedAt: string
}

export class ResearchReportPreviewDto {
  @ApiProperty() runId: string
  @ApiProperty() messageId: string
  @ApiProperty() messageVersion: number
  @ApiProperty() title: string
  @ApiProperty() summary: string
  @ApiPropertyOptional({ nullable: true, format: 'date' }) dataAsOf: string | null
  @ApiProperty({ type: [ResearchReportCitationDto] }) citations: ResearchReportCitationDto[]
  @ApiProperty({ type: [Object] }) contentBlocks: object[]
  @ApiProperty({ format: 'date-time' }) confirmationExpiresAt: string
}

export class ResearchReportResponseDto {
  @ApiProperty() reportId: string
  @ApiProperty() runId: string
  @ApiProperty() conversationId: string
  @ApiProperty() messageId: string
  @ApiProperty() messageVersion: number
  @ApiProperty() version: number
  @ApiProperty({ enum: AiResearchReportStatus }) status: AiResearchReportStatus
  @ApiProperty() title: string
  @ApiProperty() summary: string
  @ApiPropertyOptional({ nullable: true, format: 'date' }) dataAsOf: string | null
  @ApiPropertyOptional({ nullable: true }) journalId: number | null
  @ApiPropertyOptional({ nullable: true }) errorMessage: string | null
  @ApiProperty({ format: 'date-time' }) createdAt: string
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) renderedAt: string | null
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) deletedAt: string | null
}

export class ResearchReportDetailCitationDto extends ResearchReportCitationDto {
  @ApiProperty() conclusionLevel: string
  @ApiProperty() sourceType: string
  @ApiPropertyOptional({ nullable: true }) publisher: string | null
  @ApiProperty() contentHash: string
  @ApiProperty({ type: Object }) locator: object
}

export class ResearchReportDetailResponseDto extends ResearchReportResponseDto {
  @ApiPropertyOptional({ nullable: true }) contentText: string | null
  @ApiProperty({ type: [Object] }) contentBlocks: object[]
  @ApiProperty({ type: [ResearchReportDetailCitationDto] }) citations: ResearchReportDetailCitationDto[]
  @ApiProperty({ type: Object }) manifest: object
}

export class ResearchReportListResponseDto {
  @ApiProperty({ type: [ResearchReportResponseDto] }) items: ResearchReportResponseDto[]
  @ApiPropertyOptional({ nullable: true }) nextCursor: string | null
}

export class ResearchReportSaveResponseDto {
  @ApiProperty() requiresConfirmation: boolean
  @ApiPropertyOptional({ type: ResearchReportPreviewDto }) preview?: ResearchReportPreviewDto
  @ApiPropertyOptional({ description: '仅预览阶段返回' }) confirmationToken?: string
  @ApiPropertyOptional({ type: ResearchReportResponseDto }) report?: ResearchReportResponseDto
}
