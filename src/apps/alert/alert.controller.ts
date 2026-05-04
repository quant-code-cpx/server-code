import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { Roles } from 'src/common/decorators/roles.decorator'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { TokenPayload } from 'src/shared/token.interface'
import { ApiSuccessRawResponse, ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { AlertCalendarService } from './alert-calendar.service'
import { AlertLimitService } from './alert-limit.service'
import { MarketAnomalyService } from './market-anomaly.service'
import { PriceAlertService } from './price-alert.service'
import { CalendarQueryDto } from './dto/calendar-query.dto'
import { AlertLimitListDto, AlertLimitNextDayPerfDto, AlertLimitSummaryDto } from './dto/alert-limit.dto'
import {
  CreatePriceAlertRuleDto,
  ListPriceAlertHistoryDto,
  ListPriceAlertRulesDto,
  UpdatePriceAlertRuleDto,
} from './dto/price-alert-rule.dto'
import { MarketAnomalyListResponseDto, MarketAnomalyQueryDto } from './dto/market-anomaly.dto'

@ApiBearerAuth()
@ApiTags('Alert - 预警与监控')
@Controller('alert')
@UseGuards(RolesGuard)
export class AlertController {
  constructor(
    private readonly calendarService: AlertCalendarService,
    private readonly priceAlertService: PriceAlertService,
    private readonly marketAnomalyService: MarketAnomalyService,
    private readonly alertLimitService: AlertLimitService,
  ) {}

  // ── 事件日历 ──────────────────────────────────────────────────────────────

  @ApiOperation({ summary: '查询事件日历（财报披露/限售解禁/除权除息/业绩预告）' })
  @ApiSuccessRawResponse({ type: 'array', items: { type: 'object' } })
  @Post('calendar/list')
  getCalendar(@Body() query: CalendarQueryDto) {
    return this.calendarService.getCalendar(query)
  }

  // ── 价格预警规则 ──────────────────────────────────────────────────────────

  @ApiOperation({ summary: '创建价格预警规则' })
  @ApiSuccessRawResponse({ type: 'object' })
  @Post('price-rules')
  createRule(@CurrentUser() user: TokenPayload, @Body() dto: CreatePriceAlertRuleDto) {
    return this.priceAlertService.createRule(user.id, dto)
  }

  @ApiOperation({ summary: '查询我的价格预警规则列表（支持筛选分页排序）' })
  @ApiSuccessRawResponse({ type: 'object' })
  @Post('price-rules/list')
  listRules(@CurrentUser() user: TokenPayload, @Body() dto: ListPriceAlertRulesDto) {
    return this.priceAlertService.listRules(user.id, dto)
  }

  @ApiOperation({ summary: '查询价格预警触发历史' })
  @ApiSuccessRawResponse({ type: 'object' })
  @Post('price-rules/history/list')
  listHistory(@CurrentUser() user: TokenPayload, @Body() dto: ListPriceAlertHistoryDto) {
    return this.priceAlertService.listHistory(user.id, dto)
  }

  @ApiOperation({ summary: '查询价格预警扫描状态（最近扫描时间、活跃规则数等）' })
  @ApiSuccessRawResponse({ type: 'object' })
  @Post('price-rules/scan-status')
  scanStatus(@CurrentUser() user: TokenPayload) {
    return this.priceAlertService.scanStatus(user.id)
  }

  @ApiOperation({ summary: '更新价格预警规则' })
  @ApiSuccessRawResponse({ type: 'object' })
  @Post('price-rules/update')
  updateRule(@CurrentUser() user: TokenPayload, @Body() dto: UpdatePriceAlertRuleDto) {
    return this.priceAlertService.updateRule(user.id, dto.id, dto)
  }

  @ApiOperation({ summary: '删除价格预警规则（软删除）' })
  @ApiSuccessRawResponse({ type: 'object' })
  @Post('price-rules/delete')
  deleteRule(@CurrentUser() user: TokenPayload, @Body() dto: { id: number }) {
    return this.priceAlertService.deleteRule(user.id, dto.id)
  }

  @ApiOperation({ summary: '手动触发价格预警扫描（管理员）' })
  @ApiSuccessRawResponse({ type: 'object' })
  @Post('price-rules/scan')
  @Roles(UserRole.ADMIN)
  triggerPriceAlertScan() {
    return this.priceAlertService.runScan()
  }

  // ── 异动监控 ─────────────────────────────────────────────────────────────

  @ApiOperation({ summary: '查询异动监控记录（含统计聚合与排序）' })
  @ApiSuccessResponse(MarketAnomalyListResponseDto)
  @Post('anomalies/list')
  getAnomalies(@Body() query: MarketAnomalyQueryDto) {
    return this.marketAnomalyService.queryAnomalies(query)
  }

  @ApiOperation({ summary: '异动监控统计聚合（各类型数量、最近扫描时间）' })
  @ApiSuccessRawResponse({ type: 'object' })
  @Post('anomalies/summary')
  getAnomalySummary(@Body() body: { tradeDate?: string }) {
    return this.marketAnomalyService.getSummary(body.tradeDate)
  }

  @ApiOperation({ summary: '单条异动详情（含股票名称、结构化 detail）' })
  @ApiSuccessRawResponse({ type: 'object', nullable: true })
  @Post('anomalies/detail')
  getAnomalyDetail(@Body() body: { id: number }) {
    return this.marketAnomalyService.getDetail(body.id)
  }

  @ApiOperation({ summary: '手动触发异动监控扫描（管理员）' })
  @ApiSuccessRawResponse({ type: 'object' })
  @Post('anomalies/scan')
  @Roles(UserRole.ADMIN)
  triggerAnomalyScan() {
    return this.marketAnomalyService.runScan()
  }

  @ApiOperation({ summary: '涨跌停股票列表（含封单形态、连板状态、概念）' })
  @ApiSuccessRawResponse({ type: 'object' })
  @Post('limit-list')
  getLimitList(@Body() dto: AlertLimitListDto) {
    return this.alertLimitService.list(dto)
  }

  @ApiOperation({ summary: '涨跌停统计聚合' })
  @ApiSuccessRawResponse({ type: 'object' })
  @Post('limit-summary')
  getLimitSummary(@Body() dto: AlertLimitSummaryDto) {
    return this.alertLimitService.summary(dto)
  }

  @ApiOperation({ summary: '涨跌停次日表现统计' })
  @ApiSuccessRawResponse({ type: 'object' })
  @Post('limit-next-day-perf')
  getLimitNextDayPerf(@Body() dto: AlertLimitNextDayPerfDto) {
    return this.alertLimitService.nextDayPerf(dto)
  }
}
