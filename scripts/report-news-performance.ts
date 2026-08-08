import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { cpus, freemem, platform, release, totalmem } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { JwtService } from '@nestjs/jwt'
import { nanoid } from 'nanoid'
import { createClient } from 'redis'
import {
  buildNewsPerformanceReport,
  type NewsPerformanceReportInput,
} from 'src/apps/news/nonfunctional/news-performance-gate'
import {
  buildNewsPerformanceProfile,
  performanceAccessTokenTtlSeconds,
  type NewsPerformanceEnvironment,
} from 'src/apps/news/nonfunctional/news-performance-profile'
import { buildNewsSoakReport, type NewsSoakTelemetrySample } from 'src/apps/news/nonfunctional/news-soak-gate'

type Mode = 'preflight' | 'finalize'

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2))
  const profile = buildNewsPerformanceProfile(process.env as NewsPerformanceEnvironment)
  if (
    !profile.enabled ||
    (profile.profile !== 'load' && profile.profile !== 'soak') ||
    !profile.datasetId ||
    !profile.databaseSchema ||
    !profile.duration ||
    !profile.virtualUsers
  ) {
    throw new Error('正式报告要求 NEWS_PERF_ENABLED=true 且 NEWS_PERF_PROFILE=load/soak')
  }
  assertDatabaseSchema(profile.databaseSchema, process.env.DATABASE_URL)
  const runId = parseRunId(process.env.NEWS_PERF_RUN_ID)
  const reportDirectory = resolve(process.cwd(), process.env.NEWS_PERF_REPORT_DIR?.trim() || 'storage/news-performance')
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 })
  await chmod(reportDirectory, 0o700)

  const prisma = new PrismaClient()
  try {
    const database = await readDatabaseEvidence(prisma, profile.datasetId)
    if (mode === 'preflight') {
      const user = await prisma.user.findUnique({ where: { account: performanceUserAccount(profile.datasetId) } })
      const checks = [
        { key: 'dataset.articles', actual: database.dataset.articles, threshold: 500_000 },
        { key: 'dataset.securityLinks', actual: database.dataset.securityLinks, threshold: 1_000_000 },
        { key: 'dataset.stocks', actual: database.dataset.stocks, threshold: 1_000 },
        { key: 'dataset.dedicatedUser', actual: user ? 1 : 0, threshold: 1 },
      ].map((check) => ({ ...check, passed: check.actual >= check.threshold }))
      const manifest = {
        schemaVersion: 1,
        status: checks.every((check) => check.passed) ? 'READY' : 'FAILED',
        runId,
        profile: profile.profile,
        checkedAt: new Date().toISOString(),
        databaseSchema: profile.databaseSchema,
        dataset: database.dataset,
        checks,
      }
      const path = resolveReportPath(reportDirectory, `${runId}-preflight.json`)
      await writeJsonAtomic(path, manifest)
      if (manifest.status === 'READY') {
        if (!user) throw new Error('新闻性能专用用户不存在，请重新执行 seed apply')
        const secret = process.env.ACCESS_TOKEN_SECRET?.trim() ?? ''
        if (secret.length < 32) throw new Error('ACCESS_TOKEN_SECRET 必须至少 32 字符')
        const token = await new JwtService().signAsync(
          { id: user.id, account: user.account, nickname: user.nickname, role: user.role, jti: nanoid() },
          { secret, expiresIn: performanceAccessTokenTtlSeconds(profile.profile, profile.duration) },
        )
        await writeSecretAtomic(resolveReportPath(reportDirectory, `${runId}-access-token`), token)
      }
      process.stdout.write(`${JSON.stringify({ status: manifest.status, runId, reportPath: path, checks })}\n`)
      if (manifest.status !== 'READY') process.exitCode = 1
      return
    }

    const summaryPath = resolveReportPath(
      reportDirectory,
      process.env.NEWS_PERF_SUMMARY_FILE?.trim() || `${runId}-k6-summary.json`,
    )
    const k6Summary = JSON.parse(await readFile(summaryPath, 'utf8')) as NewsPerformanceReportInput['k6Summary']
    await chmod(summaryPath, 0o600)
    const redisVersion = await readRedisVersion()
    const cpuList = cpus()
    const environment = {
      os: `${platform()} ${release()} ${process.arch}`,
      cpuModel: cpuList[0]?.model ?? 'unknown',
      cpuCores: cpuList.length,
      memoryBytes: totalmem(),
      nodeVersion: process.version,
      postgresVersion: database.postgresVersion,
      redisVersion,
    }
    const load = {
      warmupRequests: 200,
      virtualUsers: profile.virtualUsers,
      duration: profile.duration,
      listWeight: 80,
      detailWeight: 20,
    }
    const report =
      profile.profile === 'load'
        ? buildNewsPerformanceReport({
            runId,
            generatedAt: new Date().toISOString(),
            profile: 'load',
            dataset: database.dataset,
            load,
            environment,
            k6Summary,
          })
        : await buildSoakReport({
            runId,
            reportDirectory,
            datasetAfter: database.dataset,
            load,
            environment,
            k6Summary,
          })
    const reportPath = resolveReportPath(reportDirectory, `${runId}-report.json`)
    await writeJsonAtomic(reportPath, report)
    process.stdout.write(
      `${JSON.stringify({
        status: report.status,
        runId,
        reportPath,
        availableMemoryBytes: freemem(),
        failedChecks: report.checks.filter((check) => !check.passed).map((check) => check.key),
      })}\n`,
    )
    await unlink(resolveReportPath(reportDirectory, `${runId}-access-token`)).catch(() => undefined)
    if (report.status !== 'PASSED') process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

async function buildSoakReport(input: {
  runId: string
  reportDirectory: string
  datasetAfter: NewsPerformanceReportInput['dataset']
  load: NewsPerformanceReportInput['load']
  environment: NewsPerformanceReportInput['environment']
  k6Summary: NewsPerformanceReportInput['k6Summary']
}) {
  const preflight = JSON.parse(
    await readFile(resolveReportPath(input.reportDirectory, `${input.runId}-preflight.json`), 'utf8'),
  ) as { runId?: string; profile?: string; dataset?: NewsPerformanceReportInput['dataset'] }
  const telemetry = JSON.parse(
    await readFile(resolveReportPath(input.reportDirectory, `${input.runId}-telemetry.json`), 'utf8'),
  ) as {
    runId?: string
    profile?: string
    collectionErrorCount?: number
    externalProviderLogScanCompleted?: boolean
    externalProviderRequestCount?: number
    samples?: NewsSoakTelemetrySample[]
  }
  if (
    preflight.runId !== input.runId ||
    preflight.profile !== 'soak' ||
    !preflight.dataset ||
    telemetry.runId !== input.runId ||
    telemetry.profile !== 'soak' ||
    !Array.isArray(telemetry.samples)
  ) {
    throw new Error('SOAK preflight/telemetry 与当前 run 不一致')
  }
  return buildNewsSoakReport({
    runId: input.runId,
    generatedAt: new Date().toISOString(),
    profile: 'soak',
    datasetBefore: preflight.dataset,
    datasetAfter: input.datasetAfter,
    load: input.load,
    environment: input.environment,
    k6Summary: input.k6Summary,
    telemetry: telemetry.samples,
    telemetryCollectionErrorCount: Number(telemetry.collectionErrorCount ?? -1),
    externalProviderLogScanCompleted: telemetry.externalProviderLogScanCompleted === true,
    externalProviderRequestCount: Number(telemetry.externalProviderRequestCount ?? -1),
  })
}

async function readDatabaseEvidence(
  prisma: PrismaClient,
  datasetId: string,
): Promise<{ dataset: NewsPerformanceReportInput['dataset']; postgresVersion: string }> {
  const feedKey = `news.perf.synthetic.${datasetId}`
  const rows = await prisma.$queryRaw<
    Array<{ articles: bigint; security_links: bigint; stocks: bigint; postgres_version: string }>
  >`
    SELECT
      (SELECT count(*) FROM news_provider_items WHERE provider_key = 'PERF_R2' AND feed_key = ${feedKey}) AS articles,
      (
        SELECT count(*) FROM news_security_links
        WHERE article_id IN (
          SELECT article_id FROM news_provider_items WHERE provider_key = 'PERF_R2' AND feed_key = ${feedKey}
        )
      ) AS security_links,
      (SELECT count(*) FROM stock_basic_profiles WHERE name LIKE ${`NEWS_PERF:${datasetId}:%`}) AS stocks,
      version() AS postgres_version
  `
  return {
    dataset: {
      articles: Number(rows[0]?.articles ?? 0),
      securityLinks: Number(rows[0]?.security_links ?? 0),
      stocks: Number(rows[0]?.stocks ?? 0),
    },
    postgresVersion: rows[0]?.postgres_version ?? 'unknown',
  }
}

async function readRedisVersion(): Promise<string> {
  const client = createClient({
    username: process.env.REDIS_USERNAME?.trim() || undefined,
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    socket: {
      host: process.env.REDIS_HOST?.trim() || 'redis',
      port: Number(process.env.REDIS_PORT || 6379),
      connectTimeout: 5_000,
    },
  })
  try {
    await client.connect()
    const info = await client.info('server')
    return info.match(/^redis_version:([^\r\n]+)$/m)?.[1] ?? 'unknown'
  } finally {
    if (client.isOpen) await client.quit()
  }
}

function parseMode(args: string[]): Mode {
  if (args.length === 1 && args[0] === '--preflight') return 'preflight'
  if (args.length === 1 && args[0] === '--finalize') return 'finalize'
  throw new Error('只允许 --preflight 或 --finalize')
}

function parseRunId(raw: string | undefined): string {
  const runId = raw?.trim() ?? ''
  if (!/^news-perf-[a-z0-9][a-z0-9-]{0,63}$/.test(runId)) throw new Error('NEWS_PERF_RUN_ID 必须使用 news-perf- 前缀')
  return runId
}

function assertDatabaseSchema(expected: string, rawDatabaseUrl: string | undefined): void {
  if (!rawDatabaseUrl) throw new Error('DATABASE_URL 不能为空')
  const databaseUrl = new URL(rawDatabaseUrl)
  if (expected === 'public' || databaseUrl.searchParams.get('schema') !== expected) {
    throw new Error('DATABASE_URL 必须精确指向 NEWS_PERF_DATABASE_SCHEMA 隔离 schema')
  }
}

function resolveReportPath(directory: string, value: string): string {
  const path = resolve(directory, value)
  if (path !== directory && !path.startsWith(`${directory}${sep}`))
    throw new Error('报告文件必须位于 NEWS_PERF_REPORT_DIR')
  return path
}

function performanceUserAccount(datasetId: string): string {
  return `news_perf_${datasetId.replace(/[^a-z0-9]+/g, '_')}`
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporaryPath, path)
    await chmod(path, 0o600)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

async function writeSecretAtomic(path: string, value: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(`${value}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporaryPath, path)
    await chmod(path, 0o600)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '新闻性能报告失败'
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorCode: 'NEWS_PERFORMANCE_GATE_FAILED', message })}\n`)
  process.exitCode = 1
})
