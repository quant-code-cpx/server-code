import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { Roles } from 'src/common/decorators/roles.decorator'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { TushareSyncService } from 'src/tushare/sync/sync.service'
import { ManualSyncDto } from './dto/manual-sync.dto'
import { ManualSyncResultDto, TushareSyncPlanDto } from './dto/tushare-sync-response.dto'

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
  @ApiOperation({ summary: '手动执行 Tushare 同步（仅超级管理员）' })
  @ApiSuccessResponse(ManualSyncResultDto)
  async manualSync(@Body() dto: ManualSyncDto) {
    return this.tushareSyncService.runManualSync(dto)
  }
}
