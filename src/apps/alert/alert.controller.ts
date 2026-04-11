import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { Roles } from 'src/common/decorators/roles.decorator'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { TokenPayload } from 'src/shared/token.interface'
import { AlertCalendarService } from './alert-calendar.service'
import { MarketAnomalyService } from './market-anomaly.service'
import { PriceAlertService } from './price-alert.service'
import { CalendarQueryDto } from './dto/calendar-query.dto'
import { CreatePriceAlertRuleDto, UpdatePriceAlertRuleDto } from './dto/price-alert-rule.dto'
import { MarketAnomalyQueryDto } from './dto/market-anomaly.dto'

@ApiBearerAuth()
@ApiTags('Alert - 预警与监控')
@Controller('alert')
@UseGuards(RolesGuard)
export class AlertController {
  constructor(
    private readonly calendarService: AlertCalendarService,
    private readonly priceAlertService: PriceAlertService,
    private readonly marketAnomalyService: MarketAnomalyService,
  ) {}

  // ── 事件日历 ──────────────────────────────────────────────────────────────

  @ApiOperation({ summary: '查询事件日历（财报披露/限售解禁/除权除息/业绩预告）' })
  @Get('calendar')
  getCalendar(@Query() query: CalendarQueryDto) {
    return this.calendarService.getCalendar(query)
  }

  // ── 价格预警规则 ──────────────────────────────────────────────────────────

  @ApiOperation({ summary: '创建价格预警规则' })
  @Post('price-rules')
  createRule(@CurrentUser() user: TokenPayload, @Body() dto: CreatePriceAlertRuleDto) {
    return this.priceAlertService.createRule(user.id, dto)
  }

  @ApiOperation({ summary: '查询我的价格预警规则列表' })
  @Get('price-rules')
  listRules(@CurrentUser() user: TokenPayload) {
    return this.priceAlertService.listRules(user.id)
  }

  @ApiOperation({ summary: '更新价格预警规则' })
  @Patch('price-rules/:id')
  updateRule(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePriceAlertRuleDto,
  ) {
    return this.priceAlertService.updateRule(user.id, id, dto)
  }

  @ApiOperation({ summary: '删除价格预警规则（软删除）' })
  @Delete('price-rules/:id')
  deleteRule(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.priceAlertService.deleteRule(user.id, id)
  }

  @ApiOperation({ summary: '手动触发价格预警扫描（管理员）' })
  @Post('price-rules/scan')
  @Roles(UserRole.ADMIN)
  triggerPriceAlertScan() {
    return this.priceAlertService.runScan()
  }

  // ── 异动监控 ─────────────────────────────────────────────────────────────

  @ApiOperation({ summary: '查询异动监控记录' })
  @Get('anomalies')
  getAnomalies(@Query() query: MarketAnomalyQueryDto) {
    return this.marketAnomalyService.queryAnomalies(query)
  }

  @ApiOperation({ summary: '手动触发异动监控扫描（管理员）' })
  @Post('anomalies/scan')
  @Roles(UserRole.ADMIN)
  triggerAnomalyScan() {
    return this.marketAnomalyService.runScan()
  }
}
