import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiSuccessRawResponse, ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { Roles } from 'src/common/decorators/roles.decorator'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { AgentErrorInterceptor } from './agent-error.interceptor'
import { AgentStrictBodyGuard } from './agent-strict-body.guard'
import { StrictAgentBody } from './strict-agent-body.decorator'
import {
  CreateModelProviderDto,
  ListModelProvidersDto,
  ModelProviderIdDto,
  UpdateModelProviderDto,
} from './dto/model/model-provider-request.dto'
import {
  ModelProviderAdminResponseDto,
  ModelProviderDeleteResponseDto,
  ModelProviderListResponseDto,
} from './dto/model/model-provider-response.dto'
import { ModelCapabilityRegistry } from '../model-gateway/model-capability.registry'
import { ModelProviderConfigService } from '../model-gateway/model-provider-config.service'

@ApiTags('Agent - 模型供应商管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, AgentStrictBodyGuard)
@UseInterceptors(AgentErrorInterceptor)
@Roles(UserRole.SUPER_ADMIN)
@Controller('agent/admin/model-providers')
export class ModelProviderAdminController {
  constructor(
    private readonly configs: ModelProviderConfigService,
    private readonly registry: ModelCapabilityRegistry,
  ) {}

  @Post('list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListModelProvidersDto)
  @ApiOperation({ summary: '查询模型供应商配置（不返回 API key）' })
  @ApiSuccessResponse(ModelProviderListResponseDto)
  list() {
    return this.configs.listAdmin()
  }

  @Post('create')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(CreateModelProviderDto)
  @ApiOperation({ summary: '新增模型供应商并立即刷新网关' })
  @ApiSuccessResponse(ModelProviderAdminResponseDto)
  async create(@Body() dto: CreateModelProviderDto) {
    const result = await this.configs.create(dto)
    await this.registry.reload()
    return result
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(UpdateModelProviderDto)
  @ApiOperation({ summary: '更新模型供应商并立即刷新网关' })
  @ApiSuccessResponse(ModelProviderAdminResponseDto)
  async update(@Body() dto: UpdateModelProviderDto) {
    const result = await this.configs.update(dto)
    await this.registry.reload()
    return result
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ModelProviderIdDto)
  @ApiOperation({ summary: '删除模型供应商并立即刷新网关' })
  @ApiSuccessResponse(ModelProviderDeleteResponseDto)
  async delete(@Body() dto: ModelProviderIdDto) {
    const result = await this.configs.remove(dto)
    await this.registry.reload()
    return result
  }

  @Post('reload')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListModelProvidersDto)
  @ApiOperation({ summary: '从数据库重新加载模型供应商配置' })
  @ApiSuccessRawResponse({ type: 'object' })
  async reload() {
    await this.registry.reload()
    return { reloaded: true, models: this.registry.list().map((item) => item.model) }
  }
}
