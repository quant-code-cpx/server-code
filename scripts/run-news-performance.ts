import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  buildNewsPerformanceProfile,
  type NewsPerformanceEnvironment,
} from 'src/apps/news/nonfunctional/news-performance-profile'

async function main(): Promise<void> {
  const profile = buildNewsPerformanceProfile(process.env as NewsPerformanceEnvironment)
  if (
    !profile.enabled ||
    (profile.profile !== 'load' && profile.profile !== 'soak') ||
    !profile.datasetId ||
    !profile.databaseSchema ||
    !profile.duration ||
    !profile.virtualUsers
  ) {
    throw new Error('news:perf:run 只允许显式开启的 load/soak profile')
  }
  if (profile.profile === 'load' && (profile.duration !== '10m' || profile.virtualUsers !== 20)) {
    throw new Error('正式 load 必须使用 20 VU/10m')
  }
  if (profile.profile === 'soak' && (profile.duration !== '2h' || profile.virtualUsers !== 20)) {
    throw new Error('正式 SOAK 必须使用 20 VU/2h，短时 smoke 不得调用正式门禁')
  }
  const runId = process.env.NEWS_PERF_RUN_ID?.trim() ?? ''
  if (!/^news-perf-[a-z0-9][a-z0-9-]{0,63}$/.test(runId)) throw new Error('NEWS_PERF_RUN_ID 必须使用 news-perf- 前缀')

  const appEnvironment = [
    'NEWS_PERF_ENABLED=true',
    `NEWS_PERF_PROFILE=${profile.profile}`,
    `NEWS_PERF_DATASET_ID=${profile.datasetId}`,
    `NEWS_PERF_DATABASE_SCHEMA=${profile.databaseSchema}`,
    `NEWS_PERF_RUN_ID=${runId}`,
    `NEWS_PERF_DURATION=${profile.duration}`,
    `NEWS_PERF_VUS=${profile.virtualUsers}`,
  ]
  const execEnvironment = appEnvironment.flatMap((value) => ['-e', value])
  runOrThrow([
    'compose',
    'exec',
    '-T',
    ...execEnvironment,
    'news-performance-app',
    'pnpm',
    'exec',
    'ts-node',
    '-r',
    'tsconfig-paths/register',
    'scripts/report-news-performance.ts',
    '--preflight',
  ])

  let telemetry: ChildProcess | undefined
  let k6: ChildProcess | undefined
  let k6Status = 1
  let telemetryStatus = profile.profile === 'soak' ? 1 : 0
  try {
    if (profile.profile === 'soak') {
      telemetry = spawn(
        'pnpm',
        ['exec', 'ts-node', '-r', 'tsconfig-paths/register', 'scripts/collect-news-soak-telemetry.ts'],
        { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
      )
    }
    k6 = spawn('docker', ['compose', '--profile', 'news-performance', 'run', '--rm', 'news-performance'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    })
    const k6Exit = waitForExit(k6)
    if (telemetry) {
      const first = await Promise.race([
        k6Exit.then((result) => ({ source: 'k6' as const, result })),
        waitForExit(telemetry).then((result) => ({ source: 'telemetry' as const, result })),
      ])
      if (first.source === 'telemetry') {
        telemetryStatus = first.result.code ?? 1
        k6.kill('SIGTERM')
        await k6Exit
        throw new Error('SOAK telemetry 在 k6 完成前退出')
      }
      k6Status = first.result.code ?? 1
      telemetry.kill('SIGTERM')
      telemetryStatus = (await waitForExit(telemetry)).code ?? 1
    } else {
      k6Status = (await k6Exit).code ?? 1
    }
  } finally {
    if (telemetry && telemetry.exitCode == null && telemetry.signalCode == null) telemetry.kill('SIGTERM')
    if (k6 && k6.exitCode == null && k6.signalCode == null) k6.kill('SIGTERM')
  }

  const finalize = spawnSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      ...execEnvironment,
      'news-performance-app',
      'pnpm',
      'exec',
      'ts-node',
      '-r',
      'tsconfig-paths/register',
      'scripts/report-news-performance.ts',
      '--finalize',
    ],
    { cwd: process.cwd(), env: process.env, stdio: 'inherit' },
  )
  await removeAccessToken(runId)
  if (k6Status !== 0 || telemetryStatus !== 0 || finalize.status !== 0) process.exitCode = 1
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode != null || child.signalCode != null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode as NodeJS.Signals | null })
  }
  return new Promise((resolveWait, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveWait({ code, signal: signal as NodeJS.Signals | null }))
  })
}

async function removeAccessToken(runId: string): Promise<void> {
  const reportDirectory = resolve(process.cwd(), process.env.NEWS_PERF_REPORT_DIR?.trim() || 'storage/news-performance')
  await unlink(resolve(reportDirectory, `${runId}-access-token`)).catch(() => undefined)
}

function runOrThrow(args: string[]): void {
  const result = spawnSync('docker', args, { cwd: process.cwd(), env: process.env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`docker ${args.slice(0, 3).join(' ')} 失败`)
}

void main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : '新闻性能门禁启动失败'
  const runId = process.env.NEWS_PERF_RUN_ID?.trim() ?? ''
  if (/^news-perf-[a-z0-9][a-z0-9-]{0,63}$/.test(runId)) await removeAccessToken(runId)
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorCode: 'NEWS_PERFORMANCE_RUN_FAILED', message })}\n`)
  process.exitCode = 1
})
