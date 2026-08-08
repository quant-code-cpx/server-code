import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiOperation, ApiTags, getSchemaPath } from '@nestjs/swagger'
import { UserRole } from '@prisma/client'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { Roles } from 'src/common/decorators/roles.decorator'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import type { TokenPayload } from 'src/shared/token.interface'
import {
  EmptyNewsRequestDto,
  NewsIngestionBackfillSecurityNoticesRequestDto,
  NewsIngestionPollFeedRequestDto,
  NewsIngestionRunRequestDto,
  NewsIngestionStatusRequestDto,
} from './dto/news-request.dto'
import {
  NewsIngestionRunResponseDto,
  NewsIngestionStatusResponseDto,
  NewsProviderListResponseDto,
} from './dto/news-response.dto'
import { NewsAdminService } from './news-admin.service'
import { NewsStrictBody, NewsStrictBodyGuard } from './news-strict-body.guard'

@ApiBearerAuth()
@ApiTags('News - 采集管理')
@Controller('news/admin')
@UseGuards(RolesGuard, NewsStrictBodyGuard)
export class NewsAdminController {
  constructor(private readonly admin: NewsAdminService) {}

  @Post('ingestion/run')
  @HttpCode(200)
  @Roles(UserRole.SUPER_ADMIN)
  @NewsStrictBody(NewsIngestionRunRequestDto)
  @ApiOperation({ summary: '幂等触发新闻采集或公告回补' })
  @ApiExtraModels(NewsIngestionPollFeedRequestDto, NewsIngestionBackfillSecurityNoticesRequestDto)
  @ApiBody({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(NewsIngestionPollFeedRequestDto) },
        { $ref: getSchemaPath(NewsIngestionBackfillSecurityNoticesRequestDto) },
      ],
      discriminator: {
        propertyName: 'operation',
        mapping: {
          POLL_FEED: getSchemaPath(NewsIngestionPollFeedRequestDto),
          BACKFILL_SECURITY_NOTICES: getSchemaPath(NewsIngestionBackfillSecurityNoticesRequestDto),
        },
      },
    },
  })
  @ApiSuccessResponse(NewsIngestionRunResponseDto)
  run(@CurrentUser() user: TokenPayload, @Body() dto: NewsIngestionRunRequestDto) {
    return this.admin.run(user.id, dto)
  }

  @Post('ingestion/status')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  @NewsStrictBody(NewsIngestionStatusRequestDto)
  @ApiOperation({ summary: '查询新闻采集命令状态' })
  @ApiSuccessResponse(NewsIngestionStatusResponseDto)
  status(@Body() dto: NewsIngestionStatusRequestDto) {
    return this.admin.status(dto.commandId)
  }

  @Post('providers/list')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  @NewsStrictBody(EmptyNewsRequestDto)
  @ApiOperation({ summary: '查询新闻 Provider 与 Feed 状态' })
  @ApiSuccessResponse(NewsProviderListResponseDto)
  providers() {
    return this.admin.providers()
  }
}
