import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { TokenPayload } from 'src/shared/token.interface'
import { ScreenerSubscriptionService } from './screener-subscription.service'
import { CreateSubscriptionDto, SubscriptionLogsQueryDto, UpdateSubscriptionDto } from './dto/subscription.dto'

@ApiTags('ScreenerSubscription - 条件订阅')
@UseGuards(JwtAuthGuard)
@Controller('screener-subscription')
export class ScreenerSubscriptionController {
  constructor(private readonly subscriptionService: ScreenerSubscriptionService) {}

  @Get()
  @ApiOperation({ summary: '获取用户所有条件订阅' })
  findAll(@CurrentUser() user: TokenPayload) {
    return this.subscriptionService.findAll(user.id)
  }

  @Post()
  @ApiOperation({ summary: '创建条件订阅' })
  create(@CurrentUser() user: TokenPayload, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptionService.create(user.id, dto)
  }

  @Put(':id')
  @ApiOperation({ summary: '更新条件订阅（名称/频率）' })
  update(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.subscriptionService.update(user.id, id, dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除条件订阅' })
  remove(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.subscriptionService.remove(user.id, id)
  }

  @Post(':id/pause')
  @ApiOperation({ summary: '暂停订阅' })
  pause(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.subscriptionService.pause(user.id, id)
  }

  @Post(':id/resume')
  @ApiOperation({ summary: '恢复订阅' })
  resume(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.subscriptionService.resume(user.id, id)
  }

  @Post(':id/run')
  @ApiOperation({ summary: '手动触发一次订阅执行' })
  manualRun(@CurrentUser() user: TokenPayload, @Param('id', ParseIntPipe) id: number) {
    return this.subscriptionService.manualRun(user.id, id)
  }

  @Get(':id/logs')
  @ApiOperation({ summary: '获取订阅执行日志' })
  getLogs(
    @CurrentUser() user: TokenPayload,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SubscriptionLogsQueryDto,
  ) {
    return this.subscriptionService.getLogs(user.id, id, query)
  }
}
