import { randomUUID } from 'node:crypto'
import { chmod, open, readFile, rename, unlink } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { scanDockerContainerLogsForExternalNewsProviderRequests } from 'src/apps/news/nonfunctional/news-provider-log-scan'

const APP_CONTAINER = 'quant_news_performance_app'

interface TelemetryArtifact {
  runId?: string
  startedAt?: string
  externalProviderLogScanCompleted?: boolean
  externalProviderRequestCount?: number
  [key: string]: unknown
}

async function main(): Promise<void> {
  const runId = parseRunId(process.env.NEWS_PERF_RUN_ID)
  const reportDirectory = resolve(process.cwd(), process.env.NEWS_PERF_REPORT_DIR?.trim() || 'storage/news-performance')
  const telemetryPath = resolveReportPath(reportDirectory, `${runId}-telemetry.json`)
  const telemetry = JSON.parse(await readFile(telemetryPath, 'utf8')) as TelemetryArtifact
  if (telemetry.runId !== runId || !telemetry.startedAt || !Number.isFinite(Date.parse(telemetry.startedAt))) {
    throw new Error('SOAK telemetry 与当前 run 不一致')
  }
  const result = await scanDockerContainerLogsForExternalNewsProviderRequests(APP_CONTAINER, telemetry.startedAt)
  telemetry.externalProviderLogScanCompleted = result.completed
  telemetry.externalProviderRequestCount = result.requestCount
  await writeJsonAtomic(telemetryPath, telemetry)
  process.stdout.write(`${JSON.stringify({ status: result.completed ? 'PASSED' : 'FAILED', runId, ...result })}\n`)
  if (!result.completed) process.exitCode = 1
}

function parseRunId(raw: string | undefined): string {
  const runId = raw?.trim() ?? ''
  if (!/^news-perf-[a-z0-9][a-z0-9-]{0,63}$/.test(runId)) throw new Error('NEWS_PERF_RUN_ID 必须使用 news-perf- 前缀')
  return runId
}

function resolveReportPath(directory: string, value: string): string {
  const path = resolve(directory, value)
  if (path !== directory && !path.startsWith(`${directory}${sep}`))
    throw new Error('遥测文件必须位于 NEWS_PERF_REPORT_DIR')
  return path
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
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
  const message = error instanceof Error ? error.message : '新闻 SOAK Provider 日志重扫失败'
  process.stderr.write(
    `${JSON.stringify({ status: 'FAILED', errorCode: 'NEWS_SOAK_PROVIDER_RESCAN_FAILED', message })}\n`,
  )
  process.exitCode = 1
})
