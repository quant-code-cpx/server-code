import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { ResearchNoteService } from './research-note.service'
import {
  CreateResearchNoteDto,
  ResearchNoteIdRequestDto,
  ResearchNoteQueryDto,
  ResearchNoteSearchRequestDto,
  ResearchNoteStockRequestDto,
  ResearchNoteTrashQueryDto,
  UpdateResearchNoteRequestDto,
} from './dto/research-note.dto'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import {
  NoteMessageResponseDto,
  ResearchNoteDto,
  ResearchNoteListResponseDto,
  ResearchNoteSearchResponseDto,
  ResearchNotesByStockResponseDto,
  UserTagsResponseDto,
} from './dto/research-note-response.dto'

@ApiTags('ResearchNote - 研究笔记')
@UseGuards(JwtAuthGuard)
@Controller('research-note')
export class ResearchNoteController {
  constructor(private readonly noteService: ResearchNoteService) {}

  @Post('list')
  @ApiOperation({ summary: '查询笔记列表（分页 + 筛选）' })
  @ApiSuccessResponse(ResearchNoteListResponseDto)
  findAll(@CurrentUser() user: TokenPayload, @Body() query: ResearchNoteQueryDto) {
    return this.noteService.findAll(user.id, query)
  }

  @Post('tags')
  @ApiOperation({ summary: '获取当前用户使用过的所有标签' })
  @ApiSuccessResponse(UserTagsResponseDto)
  getUserTags(@CurrentUser() user: TokenPayload) {
    return this.noteService.getUserTags(user.id)
  }

  @Post('stock')
  @ApiOperation({ summary: '获取某只股票的所有研究笔记' })
  @ApiSuccessResponse(ResearchNotesByStockResponseDto)
  findByStock(@CurrentUser() user: TokenPayload, @Body() dto: ResearchNoteStockRequestDto) {
    return this.noteService.findByStock(user.id, dto.tsCode)
  }

  @Post('detail')
  @ApiOperation({ summary: '获取单条笔记详情' })
  @ApiSuccessResponse(ResearchNoteDto)
  findOne(@CurrentUser() user: TokenPayload, @Body() dto: ResearchNoteIdRequestDto) {
    return this.noteService.findOne(user.id, dto.id)
  }

  @Post('create')
  @ApiOperation({ summary: '创建研究笔记' })
  @ApiSuccessResponse(ResearchNoteDto)
  create(@CurrentUser() user: TokenPayload, @Body() dto: CreateResearchNoteDto) {
    return this.noteService.create(user.id, dto)
  }

  @Post('update')
  @ApiOperation({ summary: '更新研究笔记' })
  @ApiSuccessResponse(ResearchNoteDto)
  update(@CurrentUser() user: TokenPayload, @Body() dto: UpdateResearchNoteRequestDto) {
    return this.noteService.update(user.id, dto.id, dto)
  }

  @Post('delete')
  @ApiOperation({ summary: '软删除研究笔记（移入回收站）' })
  @ApiSuccessResponse(NoteMessageResponseDto)
  remove(@CurrentUser() user: TokenPayload, @Body() dto: ResearchNoteIdRequestDto) {
    return this.noteService.remove(user.id, dto.id)
  }

  @Post('restore')
  @ApiOperation({ summary: '从回收站恢复笔记' })
  @ApiSuccessResponse(ResearchNoteDto)
  restore(@CurrentUser() user: TokenPayload, @Body() dto: ResearchNoteIdRequestDto) {
    return this.noteService.restore(user.id, dto.id)
  }

  @Post('permanent-delete')
  @ApiOperation({ summary: '永久删除笔记（不可恢复）' })
  @ApiSuccessResponse(NoteMessageResponseDto)
  permanentDelete(@CurrentUser() user: TokenPayload, @Body() dto: ResearchNoteIdRequestDto) {
    return this.noteService.permanentDelete(user.id, dto.id)
  }

  @Post('list-trash')
  @ApiOperation({ summary: '查询回收站笔记列表' })
  @ApiSuccessResponse(ResearchNoteListResponseDto)
  listTrash(@CurrentUser() user: TokenPayload, @Body() dto: ResearchNoteTrashQueryDto) {
    return this.noteService.listTrash(user.id, dto.page, dto.pageSize)
  }

  @Post('search')
  @ApiOperation({ summary: '全文搜索笔记（返回带 <mark> 高亮的片段）' })
  @ApiSuccessResponse(ResearchNoteSearchResponseDto)
  search(@CurrentUser() user: TokenPayload, @Body() dto: ResearchNoteSearchRequestDto) {
    return this.noteService.search(user.id, dto.keyword, dto.page, dto.pageSize)
  }
}
