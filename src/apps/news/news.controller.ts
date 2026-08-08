import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiSuccessResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import type { TokenPayload } from 'src/shared/token.interface'
import {
  EmptyNewsRequestDto,
  NewsHighlightsRequestDto,
  NewsArticleDetailRequestDto,
  NewsArticleListRequestDto,
} from './dto/news-request.dto'
import {
  NewsHighlightsResponseDto,
  NewsArticleDetailResponseDto,
  NewsArticleListResponseDto,
  NewsCoverageResponseDto,
} from './dto/news-response.dto'
import { NewsCoverageService } from './news-coverage.service'
import { NewsHighlightsService } from './news-highlights.service'
import { NewsQueryService } from './news-query.service'
import { NewsStrictBody, NewsStrictBodyGuard } from './news-strict-body.guard'

@ApiBearerAuth()
@ApiTags('News - 新闻时事')
@Controller('news')
@UseGuards(NewsStrictBodyGuard)
export class NewsController {
  constructor(
    private readonly query: NewsQueryService,
    private readonly coverage: NewsCoverageService,
    private readonly highlights: NewsHighlightsService,
  ) {}

  @Post('articles/list')
  @HttpCode(200)
  @NewsStrictBody(NewsArticleListRequestDto)
  @ApiOperation({ summary: '快照分页查询新闻文章' })
  @ApiSuccessResponse(NewsArticleListResponseDto)
  list(@CurrentUser() user: TokenPayload, @Body() dto: NewsArticleListRequestDto) {
    return this.query.list(user.id, dto)
  }

  @Post('articles/detail')
  @HttpCode(200)
  @NewsStrictBody(NewsArticleDetailRequestDto)
  @ApiOperation({ summary: '查询新闻文章详情与修订来源' })
  @ApiSuccessResponse(NewsArticleDetailResponseDto)
  detail(@Body() dto: NewsArticleDetailRequestDto) {
    return this.query.detail(dto.articleId)
  }

  @Post('articles/highlights')
  @HttpCode(200)
  @NewsStrictBody(NewsHighlightsRequestDto)
  @ApiOperation({ summary: '查询首页重磅新闻摘要' })
  @ApiSuccessResponse(NewsHighlightsResponseDto)
  getHighlights(@Body() dto: NewsHighlightsRequestDto) {
    return this.highlights.getHighlights(dto)
  }

  @Post('coverage')
  @HttpCode(200)
  @NewsStrictBody(EmptyNewsRequestDto)
  @ApiOperation({ summary: '查询新闻覆盖、水位与降级告警' })
  @ApiSuccessResponse(NewsCoverageResponseDto)
  getCoverage() {
    return this.coverage.getCoverage()
  }
}
