import { Body, Controller, Post, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Request } from 'express'
import { BacktestingService } from './backtesting.service'
import { SubmitBacktestingDto } from './dto/submit-backtesting.dto'
import { JobStatusDto } from './dto/job-status.dto'
import { TokenPayload } from 'src/shared/token.service'

@ApiTags('Backtesting - 回测任务')
@Controller('backtesting')
export class BacktestingController {
  constructor(private readonly backtestingService: BacktestingService) {}

  @Post('submit')
  @ApiOperation({ summary: '提交回测任务' })
  async submit(@Body() dto: SubmitBacktestingDto, @Req() req: Request & { user: TokenPayload }) {
    return this.backtestingService.submit(dto, req.user?.id ?? 0)
  }

  @Post('status')
  @ApiOperation({ summary: '查询回测任务状态' })
  async status(@Body() { jobId }: JobStatusDto) {
    return this.backtestingService.getJobStatus(jobId)
  }
}

