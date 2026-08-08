import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import {
  buildNewsPerformanceProfile,
  type NewsPerformanceEnvironment,
} from 'src/apps/news/nonfunctional/news-performance-profile'

type SeedMode = 'dry-run' | 'apply' | 'cleanup'

interface SeedPlan {
  mode: SeedMode
  datasetId: string
  databaseSchema: string
  articleCount: number
  securityLinkCount: number
  stockCount: number
}

async function main(): Promise<void> {
  const profile = buildNewsPerformanceProfile(process.env as NewsPerformanceEnvironment)
  if (!profile.enabled || !profile.datasetId || !profile.databaseSchema) {
    throw new Error('NEWS_PERF_ENABLED=true 才允许准备新闻性能数据')
  }
  assertDatabaseSchema(profile.databaseSchema, process.env.DATABASE_URL)
  const plan = buildSeedPlan(profile.datasetId, profile.databaseSchema, process.env)
  if (plan.mode === 'dry-run') {
    process.stdout.write(`${JSON.stringify({ status: 'DRY_RUN', plan }, null, 2)}\n`)
    return
  }

  const prisma = new PrismaClient()
  try {
    if (plan.mode === 'cleanup') await cleanup(prisma, plan)
    else await seed(prisma, plan)
  } finally {
    await prisma.$disconnect()
  }
}

function buildSeedPlan(datasetId: string, databaseSchema: string, env: NodeJS.ProcessEnv): SeedPlan {
  const articleCount = parseInteger(env.NEWS_PERF_ARTICLE_COUNT, 500_000, 1, 500_000, 'NEWS_PERF_ARTICLE_COUNT')
  const linksPerArticle = parseInteger(env.NEWS_PERF_LINKS_PER_ARTICLE, 2, 0, 2, 'NEWS_PERF_LINKS_PER_ARTICLE')
  const stockCount = parseInteger(env.NEWS_PERF_STOCK_COUNT, 1_000, 1, 10_000, 'NEWS_PERF_STOCK_COUNT')
  const mode = (env.NEWS_PERF_SEED_MODE?.trim() || 'dry-run') as SeedMode
  if (!['dry-run', 'apply', 'cleanup'].includes(mode)) {
    throw new Error('NEWS_PERF_SEED_MODE 只允许 dry-run/apply/cleanup')
  }
  return {
    mode,
    datasetId,
    databaseSchema,
    articleCount,
    securityLinkCount: articleCount * linksPerArticle,
    stockCount,
  }
}

function assertDatabaseSchema(expectedSchema: string, rawDatabaseUrl: string | undefined): void {
  if (!rawDatabaseUrl) throw new Error('DATABASE_URL 不能为空')
  let databaseUrl: URL
  try {
    databaseUrl = new URL(rawDatabaseUrl)
  } catch {
    throw new Error('DATABASE_URL 不是合法 URL')
  }
  if (databaseUrl.searchParams.get('schema') !== expectedSchema || expectedSchema === 'public') {
    throw new Error('DATABASE_URL 必须精确指向 NEWS_PERF_DATABASE_SCHEMA 隔离 schema')
  }
}

async function seed(prisma: PrismaClient, plan: SeedPlan): Promise<void> {
  const feedKey = `news.perf.synthetic.${plan.datasetId}`
  const linksPerArticle = Math.floor(plan.securityLinkCount / plan.articleCount)
  const performanceAccount = performanceUserAccount(plan.datasetId)
  const performancePasswordHash = await bcrypt.hash(randomUUID(), 12)
  await prisma.$transaction(
    async (tx) => {
      // 只影响当前隔离 seed 事务，不放宽应用或数据库全局超时。
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3600s'")
      await tx.$executeRawUnsafe("SET LOCAL transaction_timeout = '3600s'")
      await tx.user.upsert({
        where: { account: performanceAccount },
        update: { status: 'ACTIVE' },
        create: {
          account: performanceAccount,
          password: performancePasswordHash,
          nickname: '新闻性能专用用户',
          role: 'USER',
          status: 'ACTIVE',
        },
      })
      await tx.$executeRaw`
        INSERT INTO stock_basic_profiles (ts_code, symbol, name, synced_at)
        SELECT
          lpad(series::text, 6, '0') || '.SH',
          lpad(series::text, 6, '0'),
          ${`NEWS_PERF:${plan.datasetId}:`} || series::text,
          now()
        FROM generate_series(1, ${plan.stockCount}) AS series
        ON CONFLICT (ts_code) DO NOTHING
      `
      await tx.$executeRaw`
        INSERT INTO news_articles (
          id, identity_hash, canonical_url, canonical_url_hash, alternate_urls,
          content_type, source_type, publisher, title, excerpt, published_at,
          published_date, published_precision, language, source_country,
          current_revision, current_content_hash, quality_flags, first_seen_at,
          last_seen_at, timeline_sort_at, created_at, updated_at
        )
        SELECT
          'np' || substr(md5(${plan.datasetId}), 1, 8) || lpad(series::text, 18, '0'),
          md5(${plan.datasetId} || ':identity:' || series::text) || md5(${plan.datasetId} || ':identity:' || series::text),
          'https://news-perf.invalid/' || ${plan.datasetId} || '/' || series::text,
          md5(${plan.datasetId} || ':url:' || series::text) || md5(${plan.datasetId} || ':url:' || series::text),
          '[]'::jsonb,
          (CASE WHEN series % 3 = 0 THEN 'NOTICE' WHEN series % 3 = 1 THEN 'NEWS' ELSE 'FLASH' END)::news_content_type,
          'MEDIA'::news_source_type,
          'NEWS_PERF',
          '新闻性能合成样本 ' || series::text,
          '只用于隔离性能环境的虚构摘要 ' || series::text,
          now() - (series || ' seconds')::interval,
          NULL,
          'SECOND'::news_published_precision,
          'zh-CN',
          'CN',
          1,
          md5(${plan.datasetId} || ':content:' || series::text) || md5(${plan.datasetId} || ':content:' || series::text),
          '[]'::jsonb,
          now() - (series || ' seconds')::interval,
          now() - (series || ' seconds')::interval,
          now() - (series || ' seconds')::interval,
          now(),
          now()
        FROM generate_series(1, ${plan.articleCount}) AS series
        ON CONFLICT (id) DO NOTHING
      `
      await tx.$executeRaw`
        INSERT INTO news_article_revisions (
          article_id, revision, content_hash, raw_payload_hash, normalizer_version,
          content_type, source_type, canonical_url, alternate_urls, title, excerpt,
          publisher, published_at, published_date, published_precision, language,
          source_country, quality_flags, created_at
        )
        SELECT
          article.id, 1, article.current_content_hash,
          md5(${plan.datasetId} || ':raw:' || article.id) || md5(${plan.datasetId} || ':raw:' || article.id),
          'news-perf-v1', article.content_type, article.source_type, article.canonical_url,
          article.alternate_urls, article.title, article.excerpt, article.publisher,
          article.published_at, article.published_date, article.published_precision,
          article.language, article.source_country, article.quality_flags, article.created_at
        FROM news_articles AS article
        WHERE article.canonical_url LIKE ${`https://news-perf.invalid/${plan.datasetId}/%`}
        ON CONFLICT (article_id, revision) DO NOTHING
      `
      await tx.$executeRaw`
        INSERT INTO news_provider_items (
          provider_key, feed_key, upstream_id, article_id, source_discovered_at,
          raw_payload_hash, source_metadata, first_seen_at, last_seen_at, retrieved_at
        )
        SELECT
          'PERF_R2', ${feedKey}, article.id, article.id, article.first_seen_at,
          md5(${plan.datasetId} || ':provider:' || article.id) || md5(${plan.datasetId} || ':provider:' || article.id),
          jsonb_build_object('datasetId', ${plan.datasetId}), article.first_seen_at,
          article.last_seen_at, article.last_seen_at
        FROM news_articles AS article
        WHERE article.canonical_url LIKE ${`https://news-perf.invalid/${plan.datasetId}/%`}
        ON CONFLICT (provider_key, feed_key, upstream_id) DO NOTHING
      `
      if (linksPerArticle > 0) {
        await tx.$executeRaw`
          INSERT INTO news_security_links (article_id, ts_code, match_method, confidence, evidence, created_at)
          SELECT
            article.id,
            lpad((((substring(article.id from 11)::numeric + offset_id - 1) % ${plan.stockCount}) + 1)::text, 6, '0') || '.SH',
            'DIRECT_CODE'::news_entity_match_method,
            1.0000,
            'NEWS_PERF',
            now()
          FROM news_articles AS article
          CROSS JOIN generate_series(1, ${linksPerArticle}) AS offset_id
          WHERE article.canonical_url LIKE ${`https://news-perf.invalid/${plan.datasetId}/%`}
          ON CONFLICT (article_id, ts_code) DO NOTHING
        `
      }
    },
    { maxWait: 10_000, timeout: 3_600_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )
  const counts = await readCounts(prisma, feedKey)
  process.stdout.write(`${JSON.stringify({ status: 'SEEDED', plan, counts }, null, 2)}\n`)
}

async function cleanup(prisma: PrismaClient, plan: SeedPlan): Promise<void> {
  const feedKey = `news.perf.synthetic.${plan.datasetId}`
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        DELETE FROM news_security_links
        WHERE article_id IN (
          SELECT article_id FROM news_provider_items WHERE provider_key = 'PERF_R2' AND feed_key = ${feedKey}
        )
      `
      await tx.$executeRaw`
        DELETE FROM news_article_revisions
        WHERE article_id IN (
          SELECT article_id FROM news_provider_items WHERE provider_key = 'PERF_R2' AND feed_key = ${feedKey}
        )
      `
      await tx.$executeRaw`DELETE FROM news_provider_items WHERE provider_key = 'PERF_R2' AND feed_key = ${feedKey}`
      await tx.$executeRaw`DELETE FROM news_articles WHERE canonical_url LIKE ${`https://news-perf.invalid/${plan.datasetId}/%`}`
      await tx.$executeRaw`DELETE FROM stock_basic_profiles WHERE name LIKE ${`NEWS_PERF:${plan.datasetId}:%`}`
      await tx.user.deleteMany({ where: { account: performanceUserAccount(plan.datasetId) } })
    },
    { maxWait: 10_000, timeout: 3_600_000 },
  )
  process.stdout.write(`${JSON.stringify({ status: 'CLEANED', datasetId: plan.datasetId }, null, 2)}\n`)
}

function performanceUserAccount(datasetId: string): string {
  return `news_perf_${datasetId.replace(/[^a-z0-9]+/g, '_')}`
}

async function readCounts(prisma: PrismaClient, feedKey: string): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ articles: bigint; links: bigint }>>`
    SELECT
      (SELECT count(*) FROM news_provider_items WHERE provider_key = 'PERF_R2' AND feed_key = ${feedKey}) AS articles,
      (
        SELECT count(*) FROM news_security_links
        WHERE article_id IN (
          SELECT article_id FROM news_provider_items WHERE provider_key = 'PERF_R2' AND feed_key = ${feedKey}
        )
      ) AS links
  `
  return { articles: Number(rows[0]?.articles ?? 0), links: Number(rows[0]?.links ?? 0) }
}

function parseInteger(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (!raw?.trim()) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} 必须是 ${min}-${max} 的整数`)
  return value
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '性能数据准备失败'
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', message })}\n`)
  process.exitCode = 1
})
