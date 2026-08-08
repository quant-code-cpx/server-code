import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { ApiSuccessRawResponse } from 'src/common/decorators/api-success-response.decorator'
import { Roles } from 'src/common/decorators/roles.decorator'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { ModelCapabilityRegistry } from '../model-gateway/model-capability.registry'
import { ModelProviderConsoleService } from '../model-gateway/model-provider-console.service'
import { AgentErrorInterceptor } from './agent-error.interceptor'
import { AgentStrictBodyGuard } from './agent-strict-body.guard'
import {
  CreateModelConnectionDto,
  CreateModelDeploymentDto,
  EmptyModelConsoleDto,
  ListModelConnectionsDto,
  ListModelDeploymentsDto,
  ModelConnectionIdDto,
  ModelDeploymentIdDto,
  ProbeModelDeploymentDto,
  TestModelConnectionDto,
  UpdateModelConnectionDto,
  UpdateModelDeploymentDto,
} from './dto/model/model-provider-console.dto'
import { StrictAgentBody } from './strict-agent-body.decorator'

@ApiTags('Agent - 模型供应商控制台')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, AgentStrictBodyGuard)
@UseInterceptors(AgentErrorInterceptor)
@Roles(UserRole.SUPER_ADMIN)
@Controller('agent/admin')
export class ModelProviderConsoleController {
  constructor(
    private readonly consoleService: ModelProviderConsoleService,
    private readonly registry: ModelCapabilityRegistry,
  ) {}

  @Post('model-adapters/list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(EmptyModelConsoleDto)
  @ApiOperation({ summary: '查询已注册模型协议适配器及其能力定义' })
  @ApiSuccessRawResponse({ type: 'object' })
  listAdapters() {
    return this.consoleService.listAdapters()
  }

  @Post('model-connections/list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListModelConnectionsDto)
  @ApiSuccessRawResponse({ type: 'object' })
  listConnections(@Body() dto: ListModelConnectionsDto) {
    return this.consoleService.listConnections(dto)
  }

  @Post('model-connections/create')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(CreateModelConnectionDto)
  @ApiSuccessRawResponse({ type: 'object' })
  createConnection(@Body() dto: CreateModelConnectionDto) {
    return this.consoleService.createConnection(dto)
  }

  @Post('model-connections/update')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(UpdateModelConnectionDto)
  @ApiSuccessRawResponse({ type: 'object' })
  updateConnection(@Body() dto: UpdateModelConnectionDto) {
    return this.consoleService.updateConnection(dto)
  }

  @Post('model-connections/test')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(TestModelConnectionDto)
  @ApiSuccessRawResponse({ type: 'object' })
  testConnection(@Body() dto: TestModelConnectionDto) {
    return this.consoleService.testConnection(dto)
  }

  @Post('model-connections/delete-impact')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ModelConnectionIdDto)
  @ApiSuccessRawResponse({ type: 'object' })
  connectionDeleteImpact(@Body() dto: ModelConnectionIdDto) {
    return this.consoleService.connectionDeleteImpact(dto.id)
  }

  @Post('model-connections/delete')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ModelConnectionIdDto)
  @ApiSuccessRawResponse({ type: 'object' })
  deleteConnection(@Body() dto: ModelConnectionIdDto) {
    return this.consoleService.deleteConnection(dto.id)
  }

  @Post('model-deployments/list')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ListModelDeploymentsDto)
  @ApiSuccessRawResponse({ type: 'object' })
  listDeployments(@Body() dto: ListModelDeploymentsDto) {
    return this.consoleService.listDeployments(dto)
  }

  @Post('model-deployments/create')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(CreateModelDeploymentDto)
  @ApiSuccessRawResponse({ type: 'object' })
  createDeployment(@Body() dto: CreateModelDeploymentDto) {
    return this.consoleService.createDeployment(dto)
  }

  @Post('model-deployments/update')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(UpdateModelDeploymentDto)
  @ApiSuccessRawResponse({ type: 'object' })
  async updateDeployment(@Body() dto: UpdateModelDeploymentDto) {
    const result = await this.consoleService.updateDeployment(dto)
    if (!result.routingChanged) return result.deployment

    let versionCreated = false
    try {
      await this.createActiveVersion()
      versionCreated = true
      await this.registry.reload()
    } catch (error) {
      if (!versionCreated) {
        await this.consoleService.restoreDeploymentEnabled(
          result.deployment.id,
          result.deployment.version,
          result.previousEnabled,
        )
      }
      throw error
    }
    return result.deployment
  }

  @Post('model-deployments/probe')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ProbeModelDeploymentDto)
  @ApiSuccessRawResponse({ type: 'object' })
  probeDeployment(@Body() dto: ProbeModelDeploymentDto) {
    return this.consoleService.probeDeployment(dto)
  }

  @Post('model-deployments/delete-impact')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ModelDeploymentIdDto)
  @ApiSuccessRawResponse({ type: 'object' })
  deploymentDeleteImpact(@Body() dto: ModelDeploymentIdDto) {
    return this.consoleService.deploymentDeleteImpact(dto.id)
  }

  @Post('model-deployments/delete')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(ModelDeploymentIdDto)
  @ApiSuccessRawResponse({ type: 'object' })
  deleteDeployment(@Body() dto: ModelDeploymentIdDto) {
    return this.consoleService.deleteDeployment(dto.id)
  }

  @Post('model-routing/summary')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(EmptyModelConsoleDto)
  @ApiSuccessRawResponse({ type: 'object' })
  summary() {
    return this.consoleService.consoleSummary()
  }

  @Post('model-routing/publish')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(EmptyModelConsoleDto)
  @ApiSuccessRawResponse({ type: 'object' })
  async publish() {
    const result = await this.createActiveVersion()
    await this.registry.reload()
    return result
  }

  private async createActiveVersion() {
    await this.consoleService.assertPublishable()
    await this.registry.validateDraft()
    return this.consoleService.createPublishedVersion()
  }
}
