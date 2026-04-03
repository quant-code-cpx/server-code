import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class ResearchNoteDto {
  @ApiProperty() id: number
  @ApiPropertyOptional({ nullable: true }) tsCode?: string | null
  @ApiProperty() title: string
  @ApiProperty() content: string
  @ApiProperty({ type: [String] }) tags: string[]
  @ApiProperty() isPinned: boolean
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
  @ApiProperty({ type: [String] }) tags: string[]
}

export class NoteMessageResponseDto {
  @ApiProperty() message: string
}
