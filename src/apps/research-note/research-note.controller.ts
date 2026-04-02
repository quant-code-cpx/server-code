import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { ResearchNoteService } from './research-note.service'
import { CreateResearchNoteDto, ResearchNoteQueryDto, UpdateResearchNoteDto } from './dto/research-note.dto'

@ApiTags('ResearchNote - 研究笔记')
@UseGuards(JwtAuthGuard)
@Controller('research-note')
export class ResearchNoteController {
  constructor(private readonly noteService: ResearchNoteService) {}

  @Get()
  @ApiOperation({ summary: '查询笔记列表（分页 + 筛选）' })
  findAll(@CurrentUser() user: TokenPayload, @Query() query: ResearchNoteQueryDto) {
    return this.noteService.findAll(user.id, query)
  }

  @Get('tags')
  @ApiOperation({ summary: '获取当前用户使用过的所有标签' })
  getUserTags(@CurrentUser() user: TokenPayload) {
    return this.noteService.getUserTags(user.id)
  }

  @Get('stock/:tsCode')
  @ApiOperation({ summary: '获取某只股票的所有研究笔记' })
  findByStock(@CurrentUser() user: TokenPayload, @Param('tsCode') tsCode: string) {
    return this.noteService.findByStock(user.id, tsCode)
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单条笔记详情' })
  findOne(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.noteService.findOne(user.id, id)
  }

  @Post()
  @ApiOperation({ summary: '创建研究笔记' })
  create(@CurrentUser() user: TokenPayload, @Body() dto: CreateResearchNoteDto) {
    return this.noteService.create(user.id, dto)
  }

  @Put(':id')
  @ApiOperation({ summary: '更新研究笔记' })
  update(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateResearchNoteDto,
  ) {
    return this.noteService.update(user.id, id, dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除研究笔记' })
  remove(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.noteService.remove(user.id, id)
  }
}
