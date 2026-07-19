import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import type { TokenPayload } from 'src/shared/token.interface'
import { AgentConversationService } from '../application/agent-conversation.service'
import { AgentRunService } from '../application/agent-run.service'
import { AgentErrorInterceptor } from './agent-error.interceptor'
import { AgentStrictBodyGuard } from './agent-strict-body.guard'
import {
  ConversationDetailDto,
  CreateConversationDto,
  ListConversationMessagesDto,
  ListConversationsDto,
  UpdateConversationModelDto,
} from './dto/conversation/conversation-request.dto'
import {
  AgentConversationDetailResponseDto,
  AgentConversationListResponseDto,
  AgentMessageListResponseDto,
  CreateConversationResponseDto,
  UpdateConversationModelResponseDto,
} from './dto/conversation/conversation-response.dto'
import {
  AgentRunStatusDto,
  CancelAgentRunDto,
  ListAgentToolCallsDto,
  RegenerateAgentMessageDto,
  SendAgentMessageDto,
} from './dto/run/run-request.dto'
import {
  AgentRunCreatedResponseDto,
  AgentRunRegeneratedResponseDto,
  AgentRunStatusResponseDto,
  AgentToolCallListResponseDto,
  CancelAgentRunResponseDto,
} from './dto/run/run-response.dto'
import { StrictAgentBody } from './strict-agent-body.decorator'

@ApiTags('Agent - 会话与运行')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AgentStrictBodyGuard)
@UseInterceptors(AgentErrorInterceptor)
@Controller('agent')
export class AgentController {
  constructor(
    private readonly conversations: AgentConversationService,
    private readonly runs: AgentRunService,
  ) {}

  @Post('conversations/create')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(CreateConversationDto)
  @ApiOperation({ summary: '创建 Agent 会话' })
  @ApiSuccessResponse(CreateConversationResponseDto)
  createConversation(@CurrentUser() user: TokenPayload, @Body() dto: CreateConversationDto) {
    return this.conversations.create(user.id, dto)
  }

  @Post('conversations/list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListConversationsDto)
  @ApiOperation({ summary: '分页查询 Agent 会话' })
  @ApiSuccessResponse(AgentConversationListResponseDto)
  listConversations(@CurrentUser() user: TokenPayload, @Body() dto: ListConversationsDto) {
    return this.conversations.list(user.id, dto)
  }

  @Post('conversations/detail')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ConversationDetailDto)
  @ApiOperation({ summary: '查询 Agent 会话详情' })
  @ApiSuccessResponse(AgentConversationDetailResponseDto)
  conversationDetail(@CurrentUser() user: TokenPayload, @Body() dto: ConversationDetailDto) {
    return this.conversations.detail(user.id, dto)
  }

  @Post('conversations/messages/list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListConversationMessagesDto)
  @ApiOperation({ summary: '分页查询会话消息、引用与 Run 摘要' })
  @ApiSuccessResponse(AgentMessageListResponseDto)
  listConversationMessages(@CurrentUser() user: TokenPayload, @Body() dto: ListConversationMessagesDto) {
    return this.conversations.listMessages(user.id, dto)
  }

  @Post('conversations/model/update')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(UpdateConversationModelDto)
  @ApiOperation({ summary: '更新会话后续 Run 的模型策略' })
  @ApiSuccessResponse(UpdateConversationModelResponseDto)
  updateConversationModel(@CurrentUser() user: TokenPayload, @Body() dto: UpdateConversationModelDto) {
    return this.conversations.updateModel(user.id, dto)
  }

  @Post('messages/send')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(SendAgentMessageDto)
  @ApiOperation({ summary: '原子创建消息与 Agent Run，并可靠入队' })
  @ApiSuccessResponse(AgentRunCreatedResponseDto)
  sendMessage(@CurrentUser() user: TokenPayload, @Body() dto: SendAgentMessageDto) {
    return this.runs.send(user.id, dto)
  }

  @Post('runs/regenerate')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(RegenerateAgentMessageDto)
  @ApiOperation({ summary: '创建 assistant 新版本并重新运行' })
  @ApiSuccessResponse(AgentRunRegeneratedResponseDto)
  regenerate(@CurrentUser() user: TokenPayload, @Body() dto: RegenerateAgentMessageDto) {
    return this.runs.regenerate(user.id, dto)
  }

  @Post('runs/status')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(AgentRunStatusDto)
  @ApiOperation({ summary: '查询 Agent Run 权威状态' })
  @ApiSuccessResponse(AgentRunStatusResponseDto)
  runStatus(@CurrentUser() user: TokenPayload, @Body() dto: AgentRunStatusDto) {
    return this.runs.status(user.id, dto)
  }

  @Post('runs/cancel')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(CancelAgentRunDto)
  @ApiOperation({ summary: 'CAS 取消 Agent Run' })
  @ApiSuccessResponse(CancelAgentRunResponseDto)
  cancelRun(@CurrentUser() user: TokenPayload, @Body() dto: CancelAgentRunDto) {
    return this.runs.cancel(user.id, dto)
  }

  @Post('runs/tool-calls/list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListAgentToolCallsDto)
  @ApiOperation({ summary: '查询 Run 的脱敏 Tool 调用摘要' })
  @ApiSuccessResponse(AgentToolCallListResponseDto)
  listToolCalls(@CurrentUser() user: TokenPayload, @Body() dto: ListAgentToolCallsDto) {
    return this.runs.listToolCalls(user.id, dto)
  }
}
