import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { ApiSuccessRawResponse, ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { ResponseModel } from 'src/common/models/response.model'
import { Roles } from 'src/common/decorators/roles.decorator'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { TushareSyncService } from 'src/tushare/sync/sync.service'
import { DataQualityService } from 'src/tushare/sync/quality/data-quality.service'
import { SyncLogService } from 'src/tushare/sync/sync-log.service'
import { ManualSyncDto } from './dto/manual-sync.dto'
import { CacheMetricsDataDto, TushareSyncPlanDto } from './dto/tushare-sync-response.dto'
import { SyncLogQueryDto } from './dto/sync-log-query.dto'

@ApiBearerAuth()
@ApiTags('Tushare - 同步管理')
@Controller('tushare/admin')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class TushareAdminController {
  constructor(
    private readonly tushareSyncService: TushareSyncService,
    private readonly dataQualityService: DataQualityService,
    private readonly syncLogService: SyncLogService,
  ) {}

  @Post('plans')
  @ApiOperation({ summary: '获取可用的 Tushare 同步任务计划（仅超级管理员）' })
  @ApiSuccessResponse(TushareSyncPlanDto, { isArray: true })
  getPlans() {
    return this.tushareSyncService.getAvailableSyncPlans()
  }

  @Post('cache/stats')
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

  @Post('quality/report')
  @ApiOperation({ summary: '查询最近 N 天数据质量检查结果（仅超级管理员）' })
  @ApiSuccessRawResponse({ type: 'array', items: { type: 'object' } })
  async getQualityReport(@Body() dto: { days?: number }) {
    return this.dataQualityService.getRecentChecks(dto.days ?? 7)
  }

  @Post('quality/gaps')
  @ApiOperation({ summary: '查询指定数据集的缺失日期（仅超级管理员）' })
  @ApiSuccessRawResponse({ type: 'object' })
  async getDataGaps(@Body() dto: { dataSet: string }) {
    return this.dataQualityService.getDataGaps(dto.dataSet)
  }

  @Post('validation-logs')
  @ApiOperation({ summary: '查询数据校验异常日志（仅超级管理员）' })
  @ApiSuccessRawResponse({ type: 'array', items: { type: 'object' } })
  async getValidationLogs(@Body() dto: { task?: string; limit?: number }) {
    return this.dataQualityService.getValidationLogs({ task: dto.task, limit: dto.limit })
  }

  @Post('sync-logs')
  @ApiOperation({
    summary: '查询同步日志（仅超级管理员）',
    description: '支持按任务类型、状态、时间范围过滤，按 startedAt 倒序返回。',
  })
  @ApiSuccessRawResponse({ type: 'object' })
  async getSyncLogs(@Body() dto: SyncLogQueryDto) {
    return this.syncLogService.queryLogs(dto)
  }

  @Post('sync-logs/summary')
  @ApiOperation({
    summary: '各任务最后同步状态汇总（仅超级管理员）',
    description: '返回所有同步任务的最后同步时间、状态、行数和连续失败次数，用于总览面板。',
  })
  @ApiSuccessRawResponse({ type: 'array', items: { type: 'object' } })
  async getSyncLogsSummary() {
    return this.syncLogService.summarizeLogs()
  }
}
