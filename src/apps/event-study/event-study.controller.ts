import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { Roles } from 'src/common/decorators/roles.decorator'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { TokenPayload } from 'src/shared/token.interface'
import { CreateSignalRuleDto } from './dto/create-signal-rule.dto'
import { EventStudyAnalyzeDto } from './dto/event-study-analyze.dto'
import { EventStudyEventsQueryDto } from './dto/event-study-events-query.dto'
import { EventStudyResultDto } from './dto/event-study-response.dto'
import { UpdateSignalRuleDto } from './dto/update-signal-rule.dto'
import { EventSignalService } from './event-signal.service'
import { EventStudyService } from './event-study.service'

@ApiTags('Event Study - 事件驱动研究')
@ApiBearerAuth()
@Controller('event-study')
export class EventStudyController {
  constructor(
    private readonly eventStudyService: EventStudyService,
    private readonly eventSignalService: EventSignalService,
  ) {}

  // ── Phase 1: 事件影响分析 ──────────────────────────────────────────────────

  @Get('event-types')
  @ApiOperation({ summary: '获取系统支持的事件类型列表' })
  getEventTypes() {
    return this.eventStudyService.getEventTypes()
  }

  @Post('events')
  @ApiOperation({ summary: '分页查询指定类型的事件记录' })
  queryEvents(@Body() dto: EventStudyEventsQueryDto) {
    return this.eventStudyService.queryEvents(dto)
  }

  @Post('analyze')
  @ApiOperation({ summary: '事件影响分析（计算超额收益 AAR/CAAR）' })
  @ApiSuccessResponse(EventStudyResultDto)
  analyze(@Body() dto: EventStudyAnalyzeDto) {
    return this.eventStudyService.analyze(dto)
  }

  // ── Phase 2: 信号规则 CRUD ────────────────────────────────────────────────

  @Post('signal-rules')
  @ApiOperation({ summary: '创建事件信号规则' })
  createRule(@CurrentUser() user: TokenPayload, @Body() dto: CreateSignalRuleDto) {
    return this.eventSignalService.createRule(user.id, dto)
  }

  @Post('signal-rules/list')
  @ApiOperation({ summary: '查询我的信号规则列表' })
  listRules(@CurrentUser() user: TokenPayload, @Body() dto: { page?: number; pageSize?: number }) {
    return this.eventSignalService.listRules(user.id, dto.page, dto.pageSize)
  }

  @Patch('signal-rules/:id')
  @ApiOperation({ summary: '更新事件信号规则' })
  updateRule(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSignalRuleDto,
  ) {
    return this.eventSignalService.updateRule(user.id, id, dto)
  }

  @Delete('signal-rules/:id')
  @ApiOperation({ summary: '删除事件信号规则（软删除）' })
  deleteRule(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.eventSignalService.deleteRule(user.id, id)
  }

  // ── Phase 2: 管理端 ───────────────────────────────────────────────────────

  @Post('signal-rules/scan')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '手动触发事件信号扫描（管理员）' })
  triggerScan(@Body() dto: { tradeDate?: string }) {
    return this.eventSignalService.scanAndGenerate(dto.tradeDate)
  }

  // ── Phase 2: 信号历史 ─────────────────────────────────────────────────────

  @Post('signals')
  @ApiOperation({ summary: '查询已触发的事件信号历史' })
  querySignals(@CurrentUser() user: TokenPayload, @Body() dto: { page?: number; pageSize?: number; tsCode?: string }) {
    return this.eventSignalService.querySignals(user.id, dto)
  }
}
