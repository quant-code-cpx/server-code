import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiSuccessRawResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { Roles } from 'src/common/decorators/roles.decorator'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import type { TokenPayload } from 'src/shared/token.interface'
import { AgentEvaluationService } from '../observability/evaluation/agent-evaluation.service'
import { AgentErrorInterceptor } from './agent-error.interceptor'
import { AgentStrictBodyGuard } from './agent-strict-body.guard'
import {
  AgentEvaluationDetailDto,
  AgentEvaluationStatusDto,
  RunAgentEvaluationDto,
} from './dto/evaluation/evaluation-request.dto'
import { StrictAgentBody } from './strict-agent-body.decorator'

@ApiTags('Agent - 管理员评测')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, AgentStrictBodyGuard)
@UseInterceptors(AgentErrorInterceptor)
@Roles(UserRole.ADMIN)
@Controller('agent/admin/evaluations')
export class AgentEvaluationAdminController {
  constructor(private readonly evaluations: AgentEvaluationService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(RunAgentEvaluationDto)
  @ApiOperation({ summary: '执行版本化 fake Agent 评测（管理员）' })
  @ApiSuccessRawResponse({ type: 'object' })
  run(@CurrentUser() user: TokenPayload, @Body() dto: RunAgentEvaluationDto) {
    return this.evaluations.run(user.id, dto)
  }

  @Post('status')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(AgentEvaluationStatusDto)
  @ApiOperation({ summary: '查询 Agent 评测运行状态与版本摘要（管理员）' })
  @ApiSuccessRawResponse({ type: 'object' })
  status(@Body() dto: AgentEvaluationStatusDto) {
    return this.evaluations.status(dto.evaluationRunId)
  }

  @Post('detail')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(AgentEvaluationDetailDto)
  @ApiOperation({ summary: '查询 Agent 评测单例结果（管理员）' })
  @ApiSuccessRawResponse({ type: 'object' })
  detail(@Body() dto: AgentEvaluationDetailDto) {
    return this.evaluations.detail(dto.evaluationRunId, dto.caseId)
  }
}
