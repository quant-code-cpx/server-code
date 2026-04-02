import { Module } from '@nestjs/common'
import { ResearchNoteController } from './research-note.controller'
import { ResearchNoteService } from './research-note.service'

@Module({
  controllers: [ResearchNoteController],
  providers: [ResearchNoteService],
})
export class ResearchNoteModule {}
