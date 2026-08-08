import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { buildNewsFaultReport, type NewsFaultScenarioEvidence } from 'src/apps/news/nonfunctional/news-fault-gate'

const FAULT_SERVICES = [
  'news-fault-runner',
  'news-fault-worker',
  'news-fault-app',
  'news-fault-bridge',
  'news-fault-proxy',
  'news-fault-redis',
]

async function main(): Promise<void> {
  const runId = parseRunId(process.env.NEWS_FAULT_RUN_ID)
  const schema = parseSchema(process.env.NEWS_FAULT_DATABASE_SCHEMA)
  const reportDirectory = resolve(process.cwd(), process.env.NEWS_PERF_REPORT_DIR?.trim() || 'storage/news-performance')
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 })
  await chmod(reportDirectory, 0o700)
  let reportStatus: 'PASSED' | 'FAILED' = 'FAILED'
  try {
    runDocker(['compose', '--profile', 'news-fault', 'up', '-d', '--build', 'news-fault-app', 'news-fault-worker'])
    await waitContainerHealthy('quant_news_fault_app', 180_000)
    await waitContainerHealthy('quant_news_fault_worker', 180_000)
    prepareAccessToken(runId, schema)

    const beforeDatabase = queryFingerprint(schema)
    runFaultPhase(runId, 'database')
    const afterDatabase = queryFingerprint(schema)
    const database = await readEvidence(reportDirectory, runId, 'database')
    database.dataInvariantPreserved = JSON.stringify(beforeDatabase) === JSON.stringify(afterDatabase)

    runFaultPhase(runId, 'redis')
    const redis = await readEvidence(reportDirectory, runId, 'redis')

    runFaultPhase(runId, 'provider')
    const provider = await readEvidence(reportDirectory, runId, 'provider')

    runFaultPhase(runId, 'worker-prepare')
    const pending = JSON.parse(
      await readFile(resolveReportPath(reportDirectory, `${runId}-worker-pending.json`), 'utf8'),
    ) as { runId?: string }
    if (!pending.runId || !/^[a-z0-9]{20,32}$/.test(pending.runId)) throw new Error('Worker pending runId 非法')
    await waitRunStatus(schema, pending.runId, 'RUNNING', 30_000)
    const sigtermSentAt = new Date().toISOString()
    runDocker(['kill', '--signal=SIGTERM', 'quant_news_fault_worker'])
    await sleep(1_000)
    let forceKilled = false
    if (containerRunning('quant_news_fault_worker')) {
      runDocker(['kill', '--signal=SIGKILL', 'quant_news_fault_worker'])
      forceKilled = true
    }
    await writeJsonAtomic(resolveReportPath(reportDirectory, `${runId}-worker-kill.json`), {
      sigtermSent: true,
      sigtermSentAt,
      forceKilled,
    })
    runDocker(['compose', '--profile', 'news-fault', 'up', '-d', '--no-deps', '--force-recreate', 'news-fault-worker'])
    await waitContainerHealthy('quant_news_fault_worker', 180_000)
    runFaultPhase(runId, 'worker-verify')
    const worker = await readEvidence(reportDirectory, runId, 'worker')

    applyExactFactCounts(schema, [redis, provider, worker])
    const report = buildNewsFaultReport({
      runId,
      generatedAt: new Date().toISOString(),
      scenarios: [database, redis, provider, worker],
    })
    const reportPath = resolveReportPath(reportDirectory, `${runId}-report.json`)
    await writeJsonAtomic(reportPath, report)
    reportStatus = report.status
    process.stdout.write(
      `${JSON.stringify({ status: report.status, runId, reportPath, failedChecks: report.checks.filter((check) => !check.passed).map((check) => check.key) })}\n`,
    )
  } finally {
    await unlink(resolveReportPath(reportDirectory, `${runId}-access-token`)).catch(() => undefined)
    stopFaultServices()
    dropFaultSchema(schema)
  }
  if (reportStatus !== 'PASSED') process.exitCode = 1
}

function prepareAccessToken(runId: string, schema: string): void {
  runDocker([
    'compose',
    'exec',
    '-T',
    '-e',
    `NEWS_FAULT_RUN_ID=${runId}`,
    '-e',
    `NEWS_FAULT_DATABASE_SCHEMA=${schema}`,
    '-e',
    'NEWS_PERF_REPORT_DIR=storage/news-performance',
    'news-fault-app',
    'pnpm',
    'exec',
    'ts-node',
    '-r',
    'tsconfig-paths/register',
    'scripts/prepare-news-fault.ts',
  ])
}

function runFaultPhase(runId: string, phase: string): void {
  runDocker([
    'compose',
    '--profile',
    'news-fault',
    'run',
    '--rm',
    '-e',
    `NEWS_FAULT_RUN_ID=${runId}`,
    '-e',
    `NEWS_FAULT_PHASE=${phase}`,
    'news-fault-runner',
  ])
}

async function readEvidence(directory: string, runId: string, phase: string): Promise<NewsFaultScenarioEvidence> {
  const parsed = JSON.parse(await readFile(resolveReportPath(directory, `${runId}-${phase}-evidence.json`), 'utf8'))
  return parsed as NewsFaultScenarioEvidence
}

function queryFingerprint(schema: string): Record<string, number> {
  const sql = `SET search_path TO "${schema}", public; SELECT json_build_object('articles',(SELECT count(*) FROM news_articles),'revisions',(SELECT count(*) FROM news_article_revisions),'providerItems',(SELECT count(*) FROM news_provider_items),'commands',(SELECT count(*) FROM news_ingestion_commands),'runs',(SELECT count(*) FROM news_ingestion_runs))::text;`
  const raw = runDocker(
    [
      'exec',
      'quant_postgres',
      'psql',
      '-U',
      process.env.POSTGRES_USER?.trim() || 'postgres',
      '-d',
      'quant_db',
      '-At',
      '-c',
      sql,
    ],
    true,
  )
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
  if (!lines.length) throw new Error('故障 schema fingerprint 缺失')
  return JSON.parse(lines.at(-1)!) as Record<string, number>
}

function applyExactFactCounts(schema: string, scenarios: NewsFaultScenarioEvidence[]): void {
  const fixtureByScenario: Partial<Record<NewsFaultScenarioEvidence['scenario'], string>> = {
    REDIS_NETWORK: 'news-fault-redis-recovery',
    PROVIDER_FAILURE: 'news-fault-provider-recovery',
    WORKER_RESTART: 'news-fault-worker-restart',
  }
  for (const scenario of scenarios) {
    const upstreamId = fixtureByScenario[scenario.scenario]
    if (!upstreamId) continue
    const sql = `SET search_path TO "${schema}", public; SELECT count(*) FROM news_provider_items WHERE provider_key='AKSHARE' AND upstream_id='${upstreamId}';`
    const raw = runDocker(
      [
        'exec',
        'quant_postgres',
        'psql',
        '-U',
        process.env.POSTGRES_USER?.trim() || 'postgres',
        '-d',
        'quant_db',
        '-At',
        '-c',
        sql,
      ],
      true,
    )
    const count = Number(raw.trim().split(/\s+/).at(-1))
    scenario.duplicateFacts = Number.isInteger(count) ? Math.max(0, count - 1) : 1
    scenario.dataInvariantPreserved = scenario.dataInvariantPreserved && count === 1
  }
}

async function waitRunStatus(schema: string, runId: string, expected: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const sql = `SET search_path TO "${schema}", public; SELECT status::text FROM news_ingestion_runs WHERE id='${runId}';`
    const raw = runDocker(
      [
        'exec',
        'quant_postgres',
        'psql',
        '-U',
        process.env.POSTGRES_USER?.trim() || 'postgres',
        '-d',
        'quant_db',
        '-At',
        '-c',
        sql,
      ],
      true,
    )
    if (raw.split(/\s+/).includes(expected)) return
    await sleep(250)
  }
  throw new Error(`Run 未在时限内进入 ${expected}`)
}

async function waitContainerHealthy(container: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = runDocker(
      ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', container],
      true,
    ).trim()
    if (health === 'healthy') return
    if (health === 'unhealthy' || !containerRunning(container)) {
      const logs = runDocker(['logs', '--tail', '80', container], true)
      throw new Error(`${container} 未健康：${logs.slice(-1_000)}`)
    }
    await sleep(2_000)
  }
  throw new Error(`${container} 健康检查超时`)
}

function containerRunning(container: string): boolean {
  const result = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', container], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  return result.status === 0 && result.stdout.trim() === 'true'
}

function stopFaultServices(): void {
  spawnSync('docker', ['compose', '--profile', 'news-fault', 'stop', '-t', '10', ...FAULT_SERVICES], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
  spawnSync('docker', ['compose', '--profile', 'news-fault', 'rm', '-f', ...FAULT_SERVICES], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
}

function dropFaultSchema(schema: string): void {
  runDocker([
    'exec',
    'quant_postgres',
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    process.env.POSTGRES_USER?.trim() || 'postgres',
    '-d',
    'quant_db',
    '-c',
    `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
  ])
}

function runDocker(args: string[], capture = false): string {
  const result = spawnSync('docker', args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    ...(capture ? {} : { stdio: 'inherit' }),
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`docker ${args.slice(0, 4).join(' ')} 失败`)
  return capture ? `${result.stdout ?? ''}${result.stderr ?? ''}` : ''
}

function parseRunId(raw: string | undefined): string {
  const value = raw?.trim() ?? ''
  if (!/^news-fault-[a-z0-9][a-z0-9-]{0,63}$/.test(value))
    throw new Error('NEWS_FAULT_RUN_ID 必须使用 news-fault- 前缀')
  return value
}

function parseSchema(raw: string | undefined): string {
  const value = raw?.trim() ?? ''
  if (!/^news_perf_fault_[a-z0-9_]{1,40}$/.test(value) || value === 'public') {
    throw new Error('NEWS_FAULT_DATABASE_SCHEMA 必须使用 news_perf_fault_* 隔离 schema')
  }
  return value
}

function resolveReportPath(directory: string, filename: string): string {
  const path = resolve(directory, filename)
  if (!path.startsWith(`${directory}${sep}`)) throw new Error('故障报告必须位于 NEWS_PERF_REPORT_DIR')
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '新闻故障注入失败'
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorCode: 'NEWS_FAULT_RUN_FAILED', message })}\n`)
  process.exitCode = 1
})
