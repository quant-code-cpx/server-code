import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { NewsSoakTelemetrySample } from 'src/apps/news/nonfunctional/news-soak-gate'
import { scanDockerContainerLogsForExternalNewsProviderRequests } from 'src/apps/news/nonfunctional/news-provider-log-scan'

const execFileAsync = promisify(execFile)
const APP_CONTAINER = 'quant_news_performance_app'
const REDIS_CONTAINER = 'quant_news_performance_redis'

interface TelemetryArtifact {
  schemaVersion: 1
  runId: string
  profile: 'soak'
  startedAt: string
  finishedAt: string | null
  collectionErrorCount: number
  externalProviderLogScanCompleted: boolean
  externalProviderRequestCount: number
  samples: NewsSoakTelemetrySample[]
}

async function main(): Promise<void> {
  const runId = parseRunId(process.env.NEWS_PERF_RUN_ID)
  const reportDirectory = resolve(process.cwd(), process.env.NEWS_PERF_REPORT_DIR?.trim() || 'storage/news-performance')
  const outputPath = resolveReportPath(reportDirectory, `${runId}-telemetry.json`)
  const intervalMs = parseInterval(process.env.NEWS_PERF_TELEMETRY_INTERVAL_MS)
  const startedAt = new Date().toISOString()
  const artifact: TelemetryArtifact = {
    schemaVersion: 1,
    runId,
    profile: 'soak',
    startedAt,
    finishedAt: null,
    collectionErrorCount: 0,
    externalProviderLogScanCompleted: false,
    externalProviderRequestCount: 0,
    samples: [],
  }
  let stopping = false
  let wake: (() => void) | undefined
  const stop = () => {
    stopping = true
    wake?.()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  await mkdir(reportDirectory, { recursive: true, mode: 0o700 })
  await chmod(reportDirectory, 0o700)
  let nextSampleAt = Date.now()
  while (!stopping) {
    try {
      artifact.samples.push(await collectSample())
    } catch {
      artifact.collectionErrorCount += 1
    }
    await writeJsonAtomic(outputPath, artifact)
    if (stopping) break
    nextSampleAt += intervalMs
    const waitMs = Math.max(0, nextSampleAt - Date.now())
    await new Promise<void>((resolveWait) => {
      wake = resolveWait
      const timer = setTimeout(resolveWait, waitMs)
      const previousWake = wake
      wake = () => {
        clearTimeout(timer)
        previousWake()
      }
    })
    wake = undefined
  }
  artifact.finishedAt = new Date().toISOString()
  const providerLogScan = await scanDockerContainerLogsForExternalNewsProviderRequests(APP_CONTAINER, startedAt)
  artifact.externalProviderLogScanCompleted = providerLogScan.completed
  artifact.externalProviderRequestCount = providerLogScan.requestCount
  await writeJsonAtomic(outputPath, artifact)
  process.stdout.write(
    `${JSON.stringify({ status: 'STOPPED', runId, sampleCount: artifact.samples.length, collectionErrorCount: artifact.collectionErrorCount })}\n`,
  )
}

async function collectSample(): Promise<NewsSoakTelemetrySample> {
  const [stats, restartCount, databaseConnections, redisConnectedClients] = await Promise.all([
    docker(['stats', '--no-stream', '--format', '{{json .}}', APP_CONTAINER]),
    docker(['inspect', '--format', '{{.RestartCount}}', APP_CONTAINER]),
    databaseConnectionCount(),
    redisClientCount(),
  ])
  const parsed = JSON.parse(stats.trim()) as { CPUPerc?: string; MemUsage?: string }
  return {
    sampledAt: new Date().toISOString(),
    appMemoryBytes: parseByteSize(parsed.MemUsage?.split('/')[0]?.trim() ?? ''),
    appCpuPercent: parsePercent(parsed.CPUPerc),
    appRestartCount: parseNonNegativeInteger(restartCount, 'app restart count'),
    databaseConnections,
    redisConnectedClients,
  }
}

async function databaseConnectionCount(): Promise<number> {
  const user = process.env.POSTGRES_USER?.trim() || 'postgres'
  if (!/^[a-zA-Z_][a-zA-Z0-9_$]{0,62}$/.test(user)) throw new Error('POSTGRES_USER 非法')
  const result = await docker([
    'exec',
    'quant_postgres',
    'psql',
    '-U',
    user,
    '-d',
    'quant_db',
    '-At',
    '-c',
    "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'news-performance-app'",
  ])
  return parseNonNegativeInteger(result, 'database connections')
}

async function redisClientCount(): Promise<number> {
  const result = await docker([
    'exec',
    REDIS_CONTAINER,
    'sh',
    '-c',
    'REDISCLI_AUTH="$REDIS_PASSWORD" exec redis-cli --no-auth-warning INFO clients',
  ])
  const match = result.match(/^connected_clients:(\d+)\r?$/m)
  if (!match) throw new Error('Redis connected_clients 缺失')
  return Number(match[1])
}

async function docker(args: string[]): Promise<string> {
  const result = await execFileAsync('docker', args, { cwd: process.cwd(), maxBuffer: 5 * 1024 * 1024 })
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

function parseByteSize(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB)$/i)
  if (!match) throw new Error('Docker memory 格式非法')
  const multiplier = { B: 1, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3 }[match[2].toUpperCase()]
  if (!multiplier) throw new Error('Docker memory 单位非法')
  return Math.round(Number(match[1]) * multiplier)
}

function parsePercent(value: string | undefined): number {
  if (!value) throw new Error('Docker CPU 缺失')
  const parsed = Number(value.replace(/%$/, ''))
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Docker CPU 格式非法')
  return parsed
}

function parseNonNegativeInteger(value: string, name: string): number {
  const parsed = Number(value.trim())
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} 必须是非负整数`)
  return parsed
}

function parseRunId(raw: string | undefined): string {
  const runId = raw?.trim() ?? ''
  if (!/^news-perf-[a-z0-9][a-z0-9-]{0,63}$/.test(runId)) throw new Error('NEWS_PERF_RUN_ID 必须使用 news-perf- 前缀')
  return runId
}

function parseInterval(raw: string | undefined): number {
  const value = Number(raw?.trim() || 60_000)
  if (!Number.isInteger(value) || value < 1_000 || value > 60_000) {
    throw new Error('NEWS_PERF_TELEMETRY_INTERVAL_MS 必须是 1000-60000 的整数')
  }
  return value
}

function resolveReportPath(directory: string, value: string): string {
  const path = resolve(directory, value)
  if (path !== directory && !path.startsWith(`${directory}${sep}`))
    throw new Error('遥测文件必须位于 NEWS_PERF_REPORT_DIR')
  return path
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

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '新闻 SOAK 遥测失败'
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorCode: 'NEWS_SOAK_TELEMETRY_FAILED', message })}\n`)
  process.exitCode = 1
})
