import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import type { TokenPayload } from 'src/shared/token.interface'
import { UserMemoryService } from '../memory/user-memory.service'
import { AgentErrorInterceptor } from './agent-error.interceptor'
import { AgentStrictBodyGuard } from './agent-strict-body.guard'
import { CreateMemoryDto, DeleteMemoryDto, ListMemoriesDto, UpdateMemoryDto } from './dto/memory/memory-request.dto'
import {
  AgentMemoryListResponseDto,
  AgentMemoryResponseDto,
  DeleteAgentMemoryResponseDto,
} from './dto/memory/memory-response.dto'
import { StrictAgentBody } from './strict-agent-body.decorator'

@ApiTags('Agent - 用户记忆')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AgentStrictBodyGuard)
@UseInterceptors(AgentErrorInterceptor)
@Controller('agent/memories')
export class AgentMemoryController {
  constructor(private readonly memories: UserMemoryService) {}

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListMemoriesDto)
  @ApiOperation({ summary: '分页查询当前用户长期记忆' })
  @ApiSuccessResponse(AgentMemoryListResponseDto)
  list(@CurrentUser() user: TokenPayload, @Body() dto: ListMemoriesDto) {
    return this.memories.list(user.id, dto)
  }

  @Post('create')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(CreateMemoryDto)
  @ApiOperation({ summary: '显式确认并创建长期记忆' })
  @ApiSuccessResponse(AgentMemoryResponseDto)
  create(@CurrentUser() user: TokenPayload, @Body() dto: CreateMemoryDto) {
    return this.memories.create(user.id, dto)
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(UpdateMemoryDto)
  @ApiOperation({ summary: '显式确认并纠正长期记忆' })
  @ApiSuccessResponse(AgentMemoryResponseDto)
  update(@CurrentUser() user: TokenPayload, @Body() dto: UpdateMemoryDto) {
    return this.memories.update(user.id, dto)
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(DeleteMemoryDto)
  @ApiOperation({ summary: '删除长期记忆' })
  @ApiSuccessResponse(DeleteAgentMemoryResponseDto)
  delete(@CurrentUser() user: TokenPayload, @Body() dto: DeleteMemoryDto) {
    return this.memories.delete(user.id, dto)
  }
}
