import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AgentErrorInterceptor } from 'src/apps/agent/api/agent-error.interceptor'
import { AgentStrictBodyGuard } from 'src/apps/agent/api/agent-strict-body.guard'
import { StrictAgentBody } from 'src/apps/agent/api/strict-agent-body.decorator'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import type { TokenPayload } from 'src/shared/token.interface'
import {
  CreateScheduledResearchDto,
  ListScheduledResearchDto,
  ListScheduledResearchExecutionsDto,
  RunScheduledResearchDto,
  ScheduledResearchIdDto,
  ScheduledResearchVersionDto,
  UpdateScheduledResearchDto,
} from './dto/scheduled-research-request.dto'
import {
  RunScheduledResearchResponseDto,
  ScheduledResearchExecutionListResponseDto,
  ScheduledResearchTaskListResponseDto,
  ScheduledResearchTaskResponseDto,
} from './dto/scheduled-research-response.dto'
import { ScheduledResearchService } from './scheduled-research.service'

@ApiTags('Agent - 定时与条件研究')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AgentStrictBodyGuard)
@UseInterceptors(AgentErrorInterceptor)
@Controller('agent/schedules')
export class ScheduledResearchController {
  constructor(private readonly schedules: ScheduledResearchService) {}

  @Post('create')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(CreateScheduledResearchDto)
  @ApiOperation({ summary: '创建定时或结构化条件 Agent 研究任务' })
  @ApiSuccessResponse(ScheduledResearchTaskResponseDto)
  create(@CurrentUser() user: TokenPayload, @Body() dto: CreateScheduledResearchDto) {
    return this.schedules.create(user.id, dto)
  }

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListScheduledResearchDto)
  @ApiOperation({ summary: '分页查询当前用户的定时研究任务' })
  @ApiSuccessResponse(ScheduledResearchTaskListResponseDto)
  list(@CurrentUser() user: TokenPayload, @Body() dto: ListScheduledResearchDto) {
    return this.schedules.list(user.id, dto)
  }

  @Post('detail')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ScheduledResearchIdDto)
  @ApiOperation({ summary: '查询定时研究任务详情' })
  @ApiSuccessResponse(ScheduledResearchTaskResponseDto)
  detail(@CurrentUser() user: TokenPayload, @Body() dto: ScheduledResearchIdDto) {
    return this.schedules.detail(user.id, dto.taskId)
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(UpdateScheduledResearchDto)
  @ApiOperation({ summary: 'CAS 更新下一次触发使用的任务配置' })
  @ApiSuccessResponse(ScheduledResearchTaskResponseDto)
  update(@CurrentUser() user: TokenPayload, @Body() dto: UpdateScheduledResearchDto) {
    return this.schedules.update(user.id, dto)
  }

  @Post('pause')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ScheduledResearchVersionDto)
  @ApiOperation({ summary: 'CAS 暂停后续触发，不取消已入队 Run' })
  @ApiSuccessResponse(ScheduledResearchTaskResponseDto)
  pause(@CurrentUser() user: TokenPayload, @Body() dto: ScheduledResearchVersionDto) {
    return this.schedules.pause(user.id, dto)
  }

  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ScheduledResearchVersionDto)
  @ApiOperation({ summary: 'CAS 恢复任务，从下一逻辑触发点开始' })
  @ApiSuccessResponse(ScheduledResearchTaskResponseDto)
  resume(@CurrentUser() user: TokenPayload, @Body() dto: ScheduledResearchVersionDto) {
    return this.schedules.resume(user.id, dto)
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ScheduledResearchVersionDto)
  @ApiOperation({ summary: '软删除任务，保留 execution 审计' })
  @ApiSuccessResponse(ScheduledResearchTaskResponseDto)
  delete(@CurrentUser() user: TokenPayload, @Body() dto: ScheduledResearchVersionDto) {
    return this.schedules.delete(user.id, dto)
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(RunScheduledResearchDto)
  @ApiOperation({ summary: '按 request key 幂等地手动运行 ACTIVE 任务' })
  @ApiSuccessResponse(RunScheduledResearchResponseDto)
  run(@CurrentUser() user: TokenPayload, @Body() dto: RunScheduledResearchDto) {
    return this.schedules.runNow(user.id, dto)
  }

  @Post('executions/list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListScheduledResearchExecutionsDto)
  @ApiOperation({ summary: '分页查询任务 execution 与关联 Run 状态' })
  @ApiSuccessResponse(ScheduledResearchExecutionListResponseDto)
  listExecutions(@CurrentUser() user: TokenPayload, @Body() dto: ListScheduledResearchExecutionsDto) {
    return this.schedules.listExecutions(user.id, dto)
  }
}
