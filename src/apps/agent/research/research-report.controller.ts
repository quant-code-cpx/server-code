import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AgentErrorInterceptor } from '../api/agent-error.interceptor'
import { AgentStrictBodyGuard } from '../api/agent-strict-body.guard'
import { StrictAgentBody } from '../api/strict-agent-body.decorator'
import {
  DeleteResearchReportDto,
  ListResearchReportsDto,
  ResearchReportIdDto,
  SaveResearchReportDto,
} from '../api/dto/research/research-report-request.dto'
import {
  ResearchReportDetailResponseDto,
  ResearchReportListResponseDto,
  ResearchReportResponseDto,
  ResearchReportSaveResponseDto,
} from '../api/dto/research/research-report-response.dto'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import type { TokenPayload } from 'src/shared/token.interface'
import { ResearchReportService } from './research-report.service'

@ApiTags('Agent - 研究报告')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AgentStrictBodyGuard)
@UseInterceptors(AgentErrorInterceptor)
@Controller('agent/reports')
export class ResearchReportController {
  constructor(private readonly reports: ResearchReportService) {}

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListResearchReportsDto)
  @ApiOperation({ summary: '分页查询当前用户已确认的 Agent 研究报告' })
  @ApiSuccessResponse(ResearchReportListResponseDto)
  list(@CurrentUser() user: TokenPayload, @Body() dto: ListResearchReportsDto) {
    return this.reports.list(user.id, dto)
  }

  @Post('detail')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ResearchReportIdDto)
  @ApiOperation({ summary: '读取当前用户的 Agent 研究报告及可安全展示的内容块' })
  @ApiSuccessResponse(ResearchReportDetailResponseDto)
  detail(@CurrentUser() user: TokenPayload, @Body() dto: ResearchReportIdDto) {
    return this.reports.detail(user.id, dto.reportId)
  }

  @Post('save')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(SaveResearchReportDto)
  @ApiOperation({ summary: '预览并确认保存 Agent 研究报告；未确认不会写入报告或日志' })
  @ApiSuccessResponse(ResearchReportSaveResponseDto)
  save(@CurrentUser() user: TokenPayload, @Body() dto: SaveResearchReportDto) {
    return this.reports.save(user.id, dto)
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(DeleteResearchReportDto)
  @ApiOperation({ summary: '软删除 Agent 研究报告，并异步清理受管报告文件' })
  @ApiSuccessResponse(ResearchReportResponseDto)
  delete(@CurrentUser() user: TokenPayload, @Body() dto: DeleteResearchReportDto) {
    return this.reports.delete(user.id, dto.reportId)
  }
}
