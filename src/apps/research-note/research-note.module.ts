import { Module } from '@nestjs/common'
import { ResearchNoteAgentFacade } from './research-note-agent.facade'
import { ResearchNoteController } from './research-note.controller'
import { ResearchNoteService } from './research-note.service'

@Module({
  controllers: [ResearchNoteController],
  providers: [ResearchNoteService, ResearchNoteAgentFacade],
  exports: [ResearchNoteAgentFacade],
})
export class ResearchNoteModule {}
