import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { StrategyDraftService } from './strategy-draft.service'
import { CreateStrategyDraftDto, SubmitDraftDto, UpdateStrategyDraftDto } from './dto/strategy-draft.dto'
import { ApiSuccessResponse, ApiSuccessRawResponse } from 'src/common/decorators/api-success-response.decorator'
import {
  DraftMessageResponseDto,
  StrategyDraftDto,
  StrategyDraftListResponseDto,
} from './dto/strategy-draft-response.dto'

@ApiTags('StrategyDraft - 策略草稿箱')
@UseGuards(JwtAuthGuard)
@Controller('strategy-draft')
export class StrategyDraftController {
  constructor(private readonly draftService: StrategyDraftService) {}

  @Post('list')
  @ApiOperation({ summary: '获取用户所有草稿（按更新时间倒序）' })
  @ApiSuccessResponse(StrategyDraftListResponseDto)
  getDrafts(@CurrentUser() user: TokenPayload) {
    return this.draftService.getDrafts(user.id)
  }

  @Post('detail')
  @ApiOperation({ summary: '获取单个草稿详情' })
  @ApiSuccessResponse(StrategyDraftDto)
  getDraft(@CurrentUser() user: TokenPayload, @Body() { id }: { id: number }) {
    return this.draftService.getDraft(user.id, id)
  }

  @Post('create')
  @ApiOperation({ summary: '创建策略草稿' })
  @ApiSuccessResponse(StrategyDraftDto)
  createDraft(@CurrentUser() user: TokenPayload, @Body() dto: CreateStrategyDraftDto) {
    return this.draftService.createDraft(user.id, dto)
  }

  @Post('update')
  @ApiOperation({ summary: '更新草稿（前端自动保存调用此接口）' })
  @ApiSuccessResponse(StrategyDraftDto)
  updateDraft(@CurrentUser() user: TokenPayload, @Body() dto: UpdateStrategyDraftDto & { id: number }) {
    return this.draftService.updateDraft(user.id, dto.id, dto)
  }

  @Post('delete')
  @ApiOperation({ summary: '删除草稿' })
  @ApiSuccessResponse(DraftMessageResponseDto)
  deleteDraft(@CurrentUser() user: TokenPayload, @Body() { id }: { id: number }) {
    return this.draftService.deleteDraft(user.id, id)
  }

  @Post('submit')
  @ApiOperation({ summary: '从草稿提交回测任务' })
  @ApiSuccessRawResponse({ type: 'object', description: '回测任务创建结果，同 BacktestController.createRun 响应' })
  submitDraft(@CurrentUser() user: TokenPayload, @Body() dto: SubmitDraftDto & { id: number }) {
    return this.draftService.submitDraft(user.id, dto.id, dto)
  }
}
