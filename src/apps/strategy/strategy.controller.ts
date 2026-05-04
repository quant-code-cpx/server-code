import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { ApiSuccessResponse, ApiSuccessRawResponse } from 'src/common/decorators/api-success-response.decorator'
import { StrategyService } from './strategy.service'
import { CreateStrategyDto } from './dto/create-strategy.dto'
import { UpdateStrategyDto } from './dto/update-strategy.dto'
import { QueryStrategyDto } from './dto/query-strategy.dto'
import { RunStrategyDto } from './dto/run-strategy.dto'
import { StrategyListResponseDto, StrategyResponseDto } from './dto/strategy-response.dto'
import { CompareVersionsDto, ListVersionsDto } from './dto/strategy-version.dto'

@ApiTags('Strategy - 策略管理')
@UseGuards(JwtAuthGuard)
@Controller('strategies')
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) {}

  @Post('create')
  @ApiOperation({ summary: '创建策略模板' })
  @ApiSuccessResponse(StrategyResponseDto)
  create(@CurrentUser() user: TokenPayload, @Body() dto: CreateStrategyDto) {
    return this.strategyService.create(user.id, dto)
  }

  @Post('list')
  @ApiOperation({ summary: '查询用户策略列表（支持按类型、标签、关键词过滤，分页）' })
  @ApiSuccessResponse(StrategyListResponseDto)
  list(@CurrentUser() user: TokenPayload, @Body() dto: QueryStrategyDto) {
    return this.strategyService.list(user.id, dto)
  }

  @Post('detail')
  @ApiOperation({ summary: '查询策略详情' })
  @ApiSuccessResponse(StrategyResponseDto)
  detail(@CurrentUser() user: TokenPayload, @Body() { id }: { id: string }) {
    return this.strategyService.detail(user.id, id)
  }

  @Post('update')
  @ApiOperation({ summary: '更新策略（修改 strategyConfig 时版本号自增）' })
  @ApiSuccessResponse(StrategyResponseDto)
  update(@CurrentUser() user: TokenPayload, @Body() dto: UpdateStrategyDto) {
    return this.strategyService.update(user.id, dto)
  }

  @Post('delete')
  @ApiOperation({ summary: '删除策略（有关联数据时需传 force=true 强制删除）' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  delete(@CurrentUser() user: TokenPayload, @Body() { id, force }: { id: string; force?: boolean }) {
    return this.strategyService.delete(user.id, id, force)
  }

  @Post('clone')
  @ApiOperation({ summary: '克隆策略（复制为新策略，支持克隆公开策略）' })
  @ApiSuccessResponse(StrategyResponseDto)
  clone(@CurrentUser() user: TokenPayload, @Body() { id, name }: { id: string; name?: string }) {
    return this.strategyService.clone(user.id, id, name)
  }

  @Post('run')
  @ApiOperation({ summary: '基于策略发起回测（参数覆盖优先级：请求 > backtestDefaults > 系统默认）' })
  @ApiSuccessRawResponse({ type: 'object' })
  run(@CurrentUser() user: TokenPayload, @Body() dto: RunStrategyDto) {
    return this.strategyService.run(user.id, dto)
  }

  @Post('schemas')
  @ApiOperation({ summary: '获取所有策略类型的 JSON Schema（供前端动态渲染表单）' })
  @ApiSuccessRawResponse({ type: 'object' })
  schemas() {
    return this.strategyService.getSchemas()
  }

  @Post('versions')
  @ApiOperation({ summary: '查询策略历史版本列表' })
  @ApiSuccessRawResponse({ type: 'array' })
  listVersions(@CurrentUser() user: TokenPayload, @Body() dto: ListVersionsDto) {
    return this.strategyService.listVersions(user.id, dto.strategyId)
  }

  @Post('compare-versions')
  @ApiOperation({ summary: '对比两个版本的策略配置差异及回测指标' })
  @ApiSuccessRawResponse({ type: 'object' })
  compareVersions(@CurrentUser() user: TokenPayload, @Body() dto: CompareVersionsDto) {
    return this.strategyService.compareVersions(user.id, dto)
  }
}
