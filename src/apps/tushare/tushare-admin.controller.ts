import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { Roles } from 'src/common/decorators/roles.decorator'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { TushareSyncService } from 'src/tushare/sync/sync.service'
import { ManualSyncDto } from './dto/manual-sync.dto'
import { ManualSyncAcceptedDto, TushareSyncPlanDto } from './dto/tushare-sync-response.dto'

@ApiBearerAuth()
@ApiTags('Tushare - 同步管理')
@Controller('tushare/admin')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class TushareAdminController {
  constructor(private readonly tushareSyncService: TushareSyncService) {}

  @Get('plans')
  @ApiOperation({ summary: '获取可用的 Tushare 同步任务计划（仅超级管理员）' })
  @ApiSuccessResponse(TushareSyncPlanDto, { isArray: true })
  getPlans() {
    return this.tushareSyncService.getAvailableSyncPlans()
  }

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: '手动触发 Tushare 同步（仅超级管理员）',
    description: '同步任务在后台异步执行，结果通过 WebSocket 事件 tushare_sync_completed / tushare_sync_failed 通知前端。',
  })
  @ApiSuccessResponse(ManualSyncAcceptedDto)
  manualSync(@Body() dto: ManualSyncDto): ManualSyncAcceptedDto {
    this.tushareSyncService.triggerManualSyncAsync(dto)
    return { message: '同步任务已提交，请通过 WebSocket 获取进度通知' }
  }
}
