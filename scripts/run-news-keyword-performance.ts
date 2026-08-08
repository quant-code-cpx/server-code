import { randomUUID } from 'node:crypto'
import { chmod, open, readFile, rename, unlink } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

interface KeywordResult {
  name: string
  keyword: string
  requestCount: number
  errorCount: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
}

async function main(): Promise<void> {
  const runId = parseRunId(process.env.NEWS_PERF_RUN_ID)
  const reportDirectory = resolve(process.cwd(), process.env.NEWS_PERF_REPORT_DIR?.trim() || 'storage/news-performance')
  const tokenPath = safePath(reportDirectory, `${runId}-access-token`)
  const token = (await readFile(tokenPath, 'utf8')).trim()
  if (!token) throw new Error('新闻性能专用 access token 为空')
  const baseUrl = validateBaseUrl(process.env.NEWS_PERF_KEYWORD_BASE_URL)
  const cases = [
    { name: 'absent', keyword: '不存在关键词XYZ' },
    { name: 'rare', keyword: '合成样本 500000' },
    { name: 'high-frequency', keyword: '合成样本' },
  ]

  try {
    const results: KeywordResult[] = []
    for (const item of cases) {
      for (let index = 0; index < 5; index += 1) await requestKeyword(baseUrl, token, item.keyword)
      const timings: number[] = []
      let errorCount = 0
      for (let index = 0; index < 30; index += 1) {
        const result = await requestKeyword(baseUrl, token, item.keyword)
        timings.push(result.elapsedMs)
        if (!result.ok) errorCount += 1
      }
      timings.sort((left, right) => left - right)
      results.push({
        ...item,
        requestCount: timings.length,
        errorCount,
        p50Ms: percentile(timings, 0.5),
        p95Ms: percentile(timings, 0.95),
        p99Ms: percentile(timings, 0.99),
        maxMs: timings.at(-1) ?? 0,
      })
    }
    const report = {
      schemaVersion: 1,
      runId,
      generatedAt: new Date().toISOString(),
      status: results.every((result) => result.errorCount === 0 && result.p95Ms <= 500) ? 'PASSED' : 'FAILED',
      warmupRequestsPerCase: 5,
      results,
    }
    const reportPath = safePath(reportDirectory, `${runId}-keyword-report.json`)
    await writeJsonAtomic(reportPath, report)
    process.stdout.write(
      `${JSON.stringify({
        status: report.status,
        runId,
        reportPath,
        results: results.map((result) => ({
          name: result.name,
          requestCount: result.requestCount,
          errorCount: result.errorCount,
          p50Ms: result.p50Ms,
          p95Ms: result.p95Ms,
          p99Ms: result.p99Ms,
          maxMs: result.maxMs,
        })),
      })}\n`,
    )
    if (report.status !== 'PASSED') process.exitCode = 1
  } finally {
    await unlink(tokenPath).catch(() => undefined)
  }
}

async function requestKeyword(
  baseUrl: string,
  token: string,
  keyword: string,
): Promise<{ ok: boolean; elapsedMs: number }> {
  const startedAt = performance.now()
  const response = await fetch(`${baseUrl}/api/news/articles/list`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'ALL', limit: 50, keyword }),
  })
  await response.arrayBuffer()
  return { ok: response.status === 200, elapsedMs: performance.now() - startedAt }
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0
  return values[Math.max(0, Math.ceil(values.length * ratio) - 1)]
}

function parseRunId(raw: string | undefined): string {
  const runId = raw?.trim() ?? ''
  if (!/^news-perf-[a-z0-9][a-z0-9-]{0,63}$/.test(runId)) throw new Error('NEWS_PERF_RUN_ID 必须使用 news-perf- 前缀')
  return runId
}

function validateBaseUrl(raw: string | undefined): string {
  const value = raw?.trim() || 'http://127.0.0.1:3000'
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/') {
    throw new Error('NEWS_PERF_KEYWORD_BASE_URL 只允许容器本机 HTTP origin')
  }
  return url.origin
}

function safePath(directory: string, filename: string): string {
  const path = resolve(directory, filename)
  if (!path.startsWith(`${directory}${sep}`)) throw new Error('性能产物必须位于 NEWS_PERF_REPORT_DIR')
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
  const message = error instanceof Error ? error.message : '关键字性能门禁失败'
  process.stderr.write(
    `${JSON.stringify({ status: 'FAILED', errorCode: 'NEWS_KEYWORD_PERFORMANCE_FAILED', message })}\n`,
  )
  process.exitCode = 1
})
