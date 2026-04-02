import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { ApiSuccessRawResponse, ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { ResponseModel } from 'src/common/models/response.model'
import { Roles } from 'src/common/decorators/roles.decorator'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { TushareSyncService } from 'src/tushare/sync/sync.service'
import { DataQualityService } from 'src/tushare/sync/quality/data-quality.service'
import { ManualSyncDto } from './dto/manual-sync.dto'
import { CacheMetricsDataDto, TushareSyncPlanDto } from './dto/tushare-sync-response.dto'

@ApiBearerAuth()
@ApiTags('Tushare - 同步管理')
@Controller('tushare/admin')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class TushareAdminController {
  constructor(
    private readonly tushareSyncService: TushareSyncService,
    private readonly dataQualityService: DataQualityService,
  ) {}

  @Get('plans')
  @ApiOperation({ summary: '获取可用的 Tushare 同步任务计划（仅超级管理员）' })
  @ApiSuccessResponse(TushareSyncPlanDto, { isArray: true })
  getPlans() {
    return this.tushareSyncService.getAvailableSyncPlans()
  }

  @Get('cache/stats')
  @ApiOperation({ summary: '获取缓存命中率与当前缓存键统计（仅超级管理员）' })
  @ApiSuccessResponse(CacheMetricsDataDto)
  getCacheStats() {
    return this.tushareSyncService.getCacheStats()
  }

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: '手动触发 Tushare 同步（仅超级管理员）',
    description:
      '同步任务在后台异步执行，结果通过 WebSocket 事件 tushare_sync_completed / tushare_sync_failed 通知前端。',
  })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  manualSync(@Body() dto: ManualSyncDto): ResponseModel {
    this.tushareSyncService.triggerManualSyncAsync(dto)
    return ResponseModel.success({ message: '同步任务已提交，请通过 WebSocket 获取进度通知' })
  }

  @Post('quality/check')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '手动触发数据质量检查（仅超级管理员）' })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  triggerQualityCheck(): ResponseModel {
    void this.dataQualityService.runAllChecks()
    return ResponseModel.success({ message: '数据质量检查已提交，请稍后查询结果' })
  }

  @Get('quality/report')
  @ApiOperation({ summary: '查询最近 N 天数据质量检查结果（仅超级管理员）' })
  @ApiQuery({ name: 'days', required: false, description: '查询天数，默认 7', type: Number })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async getQualityReport(@Query('days') days?: string) {
    const parsedDays = days ? parseInt(days, 10) : 7
    return this.dataQualityService.getRecentChecks(parsedDays)
  }

  @Get('quality/gaps')
  @ApiOperation({ summary: '查询指定数据集的缺失日期（仅超级管理员）' })
  @ApiQuery({ name: 'dataSet', required: true, description: '数据集名称，如 daily, stkLimit', type: String })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async getDataGaps(@Query('dataSet') dataSet: string) {
    return this.dataQualityService.getDataGaps(dataSet)
  }

  @Get('validation-logs')
  @ApiOperation({ summary: '查询数据校验异常日志（仅超级管理员）' })
  @ApiQuery({ name: 'task', required: false, description: '过滤指定任务，如 DAILY', type: String })
  @ApiQuery({ name: 'limit', required: false, description: '返回条数上限，默认 100', type: Number })
  @ApiSuccessRawResponse({ type: 'null', nullable: true })
  async getValidationLogs(@Query('task') task?: string, @Query('limit') limit?: string) {
    return this.dataQualityService.getValidationLogs({ task, limit: limit ? parseInt(limit, 10) : undefined })
  }
}
