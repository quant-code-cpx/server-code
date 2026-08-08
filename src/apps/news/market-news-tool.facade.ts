import { Injectable } from '@nestjs/common'
import type { NewsContentType } from '@prisma/client'
import { NewsCoverageService } from './news-coverage.service'
import { NewsQueryService } from './news-query.service'

export interface MarketNewsToolInput {
  securityCodes?: string[]
  keywords?: string[]
  publishedAfter?: string
  publishedBefore?: string
  contentTypes?: NewsContentType[]
  limit?: number
}

@Injectable()
export class MarketNewsToolFacade {
  constructor(
    private readonly query: NewsQueryService,
    private readonly coverage: NewsCoverageService,
  ) {}

  async getMarketNews(userId: number, input: MarketNewsToolInput) {
    const limit = input.limit ?? 20
    const keywords = input.keywords?.length ? input.keywords : [undefined]
    const pages = await Promise.all(
      keywords.map((keyword) =>
        this.query.list(userId, {
          limit,
          scope: input.securityCodes?.length ? 'SECURITIES' : 'ALL',
          securityCodes: input.securityCodes,
          keyword,
          contentTypes: input.contentTypes,
          publishedAfter: input.publishedAfter,
          publishedBefore: input.publishedBefore,
          includeUnknownPublishedTime: true,
        }),
      ),
    )
    const items = [...new Map(pages.flatMap((page) => page.items).map((item) => [item.articleId, item])).values()]
      .sort((left, right) => sortTime(right) - sortTime(left) || right.articleId.localeCompare(left.articleId))
      .slice(0, limit)
    const coverage = await this.coverage.getCoverage({ contentTypes: input.contentTypes })
    return { items, dataThrough: coverage.dataThrough, coverage, warnings: coverage.warnings }
  }
}

function sortTime(item: { publishedAt: string | null; publishedDate: string | null; firstSeenAt: string }): number {
  return Date.parse(
    item.publishedAt ?? (item.publishedDate ? `${item.publishedDate}T00:00:00+08:00` : item.firstSeenAt),
  )
}
