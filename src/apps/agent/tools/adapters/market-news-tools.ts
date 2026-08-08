import { UserRole } from '@prisma/client'
import { MarketNewsToolFacade, type MarketNewsToolInput } from 'src/apps/news/market-news-tool.facade'
import { NewsHttpException } from 'src/apps/news/news.errors'
import type { JsonSchema } from '../../contracts'
import type { ToolDefinition } from '../contracts/tool-definition'
import { ToolAdapterError } from '../contracts/tool-error'
import { adapterToolResult } from './tool-adapter-support'

export function createMarketNewsToolDefinitions(facade: MarketNewsToolFacade): readonly ToolDefinition[] {
  return Object.freeze([marketNewsDefinition(facade)])
}

function marketNewsDefinition(facade: MarketNewsToolFacade): ToolDefinition {
  return {
    key: 'get_market_news',
    version: 1,
    description:
      '查询本地已采集的新闻、公告和快讯，并返回明确水位与覆盖告警。应先用它查本地事实；它绝不联网，高风险或最新事实需要另行使用 search_web 与 fetch_web_page 核验。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        securityCodes: {
          type: 'array',
          maxItems: 20,
          uniqueItems: true,
          items: { type: 'string', pattern: '^\\d{6}\\.(SH|SZ|BJ)$' },
        },
        keywords: {
          type: 'array',
          maxItems: 5,
          uniqueItems: true,
          items: { type: 'string', minLength: 2, maxLength: 64 },
        },
        publishedAfter: { type: 'string', format: 'date-time' },
        publishedBefore: { type: 'string', format: 'date-time' },
        contentTypes: {
          type: 'array',
          uniqueItems: true,
          items: { enum: ['NOTICE', 'NEWS', 'FLASH'] },
        },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
    },
    outputSchema: marketNewsOutputSchema(),
    policy: {
      requiredRole: UserRole.USER,
      sideEffect: 'READ',
      requiresConfirmation: false,
      idempotent: true,
      timeoutMs: 10_000,
      maxAttempts: 2,
      maxRows: 50,
      costClass: 'LOW',
      allowedDataScopes: ['PUBLIC_MARKET_DATA', 'USER_PRIVATE'],
    },
    execute: async (input, context) => {
      try {
        const data = await facade.getMarketNews(context.userId, input as MarketNewsToolInput)
        return adapterToolResult(context, input, 'get_market_news', data, {
          version: 1,
          sourceType: 'DATABASE',
          sourceServices: ['MarketNewsToolFacade', 'NewsQueryService', 'NewsCoverageService'],
          sourceModels: ['NewsArticle', 'NewsArticleRevision', 'NewsProviderItem', 'NewsIngestionCursor'],
          dataVersion: `market-news.v1:${data.dataThrough ?? 'unknown'}`,
          warnings: data.warnings.map((warning) => ({ code: warning.code, message: warning.publicMessage })),
          truncated: data.items.length >= ((input as MarketNewsToolInput).limit ?? 20),
        })
      } catch (error) {
        if (error instanceof NewsHttpException) {
          if (error.definition.key === 'NEWS_MODULE_DISABLED') {
            throw new ToolAdapterError('DATA_NOT_READY', '本地新闻模块未启用', false)
          }
          if (error.definition.key === 'NEWS_ARTICLE_NOT_FOUND') {
            throw new ToolAdapterError('DATA_NOT_FOUND', '没有找到本地新闻', false)
          }
          throw new ToolAdapterError('INVALID_ARGUMENT', error.definition.message, false)
        }
        throw new ToolAdapterError('UPSTREAM_FAILED', '本地新闻查询暂时不可用', true)
      }
    },
    countRows: (data) => (data as { items: unknown[] }).items.length,
  }
}

function marketNewsOutputSchema(): JsonSchema {
  const nullableString = { type: ['string', 'null'] }
  const warning = {
    type: 'object',
    additionalProperties: false,
    required: [
      'warningId',
      'code',
      'severity',
      'affectsCompleteness',
      'providerKey',
      'providerDisplayName',
      'feedKey',
      'feedDisplayName',
      'publicMessage',
      'dataThrough',
      'observedAt',
    ],
    properties: {
      warningId: { type: 'string' },
      code: {
        enum: [
          'FEED_UNAVAILABLE',
          'FEED_STALE',
          'FEED_DISABLED',
          'NO_SUCCESSFUL_SYNC',
          'FEED_SCHEMA_CHANGED',
          'POTENTIALLY_TRUNCATED',
          'PARTIAL_INGESTION',
          'SOURCE_WINDOW_LIMITED',
          'COVERAGE_UNKNOWN',
        ],
      },
      severity: { enum: ['INFO', 'WARNING', 'ERROR'] },
      affectsCompleteness: { type: 'boolean' },
      providerKey: nullableString,
      providerDisplayName: nullableString,
      feedKey: nullableString,
      feedDisplayName: nullableString,
      publicMessage: { type: 'string' },
      dataThrough: { ...nullableString, format: 'date-time' },
      observedAt: { type: 'string', format: 'date-time' },
    },
  }
  const feed = {
    type: 'object',
    additionalProperties: false,
    required: [
      'providerKey',
      'providerDisplayName',
      'feedKey',
      'feedDisplayName',
      'sourceType',
      'contentTypes',
      'scheduleMode',
      'requiredForCompleteness',
      'status',
      'lastSuccessfulAt',
      'dataThrough',
      'expectedIntervalSeconds',
      'freshnessSeconds',
      'consecutiveFailures',
      'potentiallyTruncated',
      'reasonCode',
      'publicReason',
    ],
    properties: {
      providerKey: { type: 'string' },
      providerDisplayName: { type: 'string' },
      feedKey: { type: 'string' },
      feedDisplayName: { type: 'string' },
      sourceType: { enum: ['REGULATOR', 'EXCHANGE', 'COMPANY', 'MEDIA', 'INSTITUTION', 'AGGREGATOR', 'OTHER'] },
      contentTypes: { type: 'array', items: { enum: ['NOTICE', 'NEWS', 'FLASH'] } },
      scheduleMode: { enum: ['SCHEDULED', 'ON_DEMAND'] },
      requiredForCompleteness: { type: 'boolean' },
      status: { enum: ['READY', 'DEGRADED', 'DISABLED'] },
      lastSuccessfulAt: { ...nullableString, format: 'date-time' },
      dataThrough: { ...nullableString, format: 'date-time' },
      expectedIntervalSeconds: { type: ['integer', 'null'] },
      freshnessSeconds: { type: ['integer', 'null'] },
      consecutiveFailures: { type: 'integer', minimum: 0 },
      potentiallyTruncated: { type: 'boolean' },
      reasonCode: { type: ['string', 'null'] },
      publicReason: nullableString,
    },
  }
  const article = {
    type: 'object',
    additionalProperties: false,
    required: [
      'articleId',
      'revision',
      'contentType',
      'sourceType',
      'title',
      'excerpt',
      'publisher',
      'canonicalUrl',
      'publishedAt',
      'publishedDate',
      'publishedPrecision',
      'firstSeenAt',
      'securityCodes',
      'providerKeys',
      'qualityFlags',
    ],
    properties: {
      articleId: { type: 'string' },
      revision: { type: 'integer', minimum: 1 },
      contentType: { enum: ['NOTICE', 'NEWS', 'FLASH'] },
      sourceType: { enum: ['REGULATOR', 'EXCHANGE', 'COMPANY', 'MEDIA', 'INSTITUTION', 'AGGREGATOR', 'OTHER'] },
      title: { type: 'string' },
      excerpt: nullableString,
      publisher: nullableString,
      canonicalUrl: nullableString,
      publishedAt: { ...nullableString, format: 'date-time' },
      publishedDate: { ...nullableString, format: 'date' },
      publishedPrecision: { enum: ['SECOND', 'MINUTE', 'DATE', 'UNKNOWN'] },
      firstSeenAt: { type: 'string', format: 'date-time' },
      securityCodes: { type: 'array', items: { type: 'string' } },
      providerKeys: { type: 'array', items: { type: 'string' } },
      qualityFlags: { type: 'array', items: { type: 'string' } },
    },
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'dataThrough', 'coverage', 'warnings'],
    properties: {
      items: { type: 'array', maxItems: 50, items: article },
      dataThrough: { ...nullableString, format: 'date-time' },
      coverage: {
        type: 'object',
        additionalProperties: false,
        required: ['generatedAt', 'overallStatus', 'dataThrough', 'partial', 'warnings', 'feeds'],
        properties: {
          generatedAt: { type: 'string', format: 'date-time' },
          overallStatus: { enum: ['READY', 'DEGRADED', 'DISABLED'] },
          dataThrough: { ...nullableString, format: 'date-time' },
          partial: { type: 'boolean' },
          warnings: { type: 'array', maxItems: 50, items: warning },
          feeds: { type: 'array', items: feed },
        },
      },
      warnings: { type: 'array', maxItems: 50, items: warning },
    },
  }
}
