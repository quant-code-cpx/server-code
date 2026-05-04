import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class ResearchNoteDto {
  @ApiProperty() id: number
  @ApiPropertyOptional({ nullable: true }) tsCode?: string | null
  @ApiProperty() title: string
  @ApiProperty() content: string
  @ApiProperty({ type: [String] }) tags: string[]
  @ApiProperty() isPinned: boolean
  @ApiProperty({ description: '正文字符数' }) wordCount: number
  @ApiProperty({ description: '版本号/版本次数' }) versionCount: number
  @ApiPropertyOptional({ nullable: true, description: '软删除时间 ISO 字符串' }) deletedAt?: string | null
  @ApiProperty() createdAt: Date
  @ApiProperty() updatedAt: Date
}

export class ResearchNoteListResponseDto {
  @ApiProperty({ type: [ResearchNoteDto] }) notes: ResearchNoteDto[]
  @ApiProperty() total: number
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
}

export class ResearchNotesByStockResponseDto {
  @ApiProperty({ type: [ResearchNoteDto] }) notes: ResearchNoteDto[]
  @ApiProperty() total: number
}

export class UserTagsResponseDto {
  @ApiProperty({ type: [Object], description: '标签及使用次数' }) tags: Array<{ tag: string; count: number }>
}

export class ResearchNoteSearchItemDto extends ResearchNoteDto {
  @ApiProperty({ description: '安全转义后的 HTML 片段，仅包含 <mark> 高亮标签' }) snippetHtml: string
  @ApiProperty({ description: '简单相关度分数' }) score: number
}

export class ResearchNoteSearchResponseDto {
  @ApiProperty({ type: [ResearchNoteSearchItemDto] }) items: ResearchNoteSearchItemDto[]
  @ApiProperty() total: number
  @ApiProperty() page: number
  @ApiProperty() pageSize: number
}

export class NoteMessageResponseDto {
  @ApiProperty() message: string
}
