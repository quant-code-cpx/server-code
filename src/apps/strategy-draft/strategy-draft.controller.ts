import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { StrategyDraftService } from './strategy-draft.service'
import { CreateStrategyDraftDto, SubmitDraftDto, UpdateStrategyDraftDto } from './dto/strategy-draft.dto'

@ApiTags('StrategyDraft - 策略草稿箱')
@UseGuards(JwtAuthGuard)
@Controller('strategy-draft')
export class StrategyDraftController {
  constructor(private readonly draftService: StrategyDraftService) {}

  @Get()
  @ApiOperation({ summary: '获取用户所有草稿（按更新时间倒序）' })
  getDrafts(@CurrentUser() user: TokenPayload) {
    return this.draftService.getDrafts(user.id)
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个草稿详情' })
  getDraft(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.draftService.getDraft(user.id, id)
  }

  @Post()
  @ApiOperation({ summary: '创建策略草稿' })
  createDraft(@CurrentUser() user: TokenPayload, @Body() dto: CreateStrategyDraftDto) {
    return this.draftService.createDraft(user.id, dto)
  }

  @Put(':id')
  @ApiOperation({ summary: '更新草稿（前端自动保存调用此接口）' })
  updateDraft(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStrategyDraftDto,
  ) {
    return this.draftService.updateDraft(user.id, id, dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除草稿' })
  deleteDraft(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.draftService.deleteDraft(user.id, id)
  }

  @Post(':id/submit')
  @ApiOperation({ summary: '从草稿提交回测任务' })
  submitDraft(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitDraftDto,
  ) {
    return this.draftService.submitDraft(user.id, id, dto)
  }
}
