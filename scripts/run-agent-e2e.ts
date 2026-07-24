import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

const rootDir = resolve(__dirname, '..')
const suffix = `${process.pid}-${Date.now()}`
const postgresContainer = `quant-agent-e2e-pg-${suffix}`
const postgresPassword = `agent-pg-${randomUUID()}`
const postgresImage = 'postgres:16-alpine'
let cleaning = false

function main(): number {
  try {
    startPostgres()
    const postgresPort = mappedPort(postgresContainer, '5432/tcp')
    const databaseUrl = `postgresql://postgres:${encodeURIComponent(postgresPassword)}@127.0.0.1:${postgresPort}/agent_e2e?schema=public`
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      TUSHARE_SYNC_ENABLED: 'false',
      TUSHARE_TOKEN: '',
      AGENT_TEST_DOCKER_VERSION: docker(['--version']).trim(),
      AGENT_TEST_POSTGRES_IMAGE: postgresImage,
    }
    const args = [
      resolve(rootDir, 'node_modules/jest/bin/jest.js'),
      '--config',
      './test/jest-e2e.json',
      'test/agent/agent-mvp.e2e-spec.ts',
      '--runInBand',
      ...process.argv.slice(2),
    ]
    const result = spawnSync(process.execPath, args, { cwd: rootDir, env, stdio: 'inherit' })
    if (result.error) throw result.error
    return result.status ?? 1
  } finally {
    cleanup()
  }
}

function startPostgres(): void {
  docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    postgresContainer,
    '--env',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    '--env',
    'POSTGRES_DB=agent_e2e',
    '--publish',
    '127.0.0.1::5432',
    postgresImage,
  ])
  waitForPostgres()
}

function mappedPort(container: string, internalPort: string): number {
  const output = docker(['port', container, internalPort]).trim()
  const match = output.match(/:(\d+)$/m)
  if (!match) throw new Error(`无法解析 ${container} 端口：${output}`)
  return Number(match[1])
}

function waitForPostgres(): void {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      execFileSync('docker', ['exec', postgresContainer, 'pg_isready', '-U', 'postgres', '-d', 'agent_e2e'], {
        stdio: 'pipe',
      })
      return
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    }
  }
  throw new Error('Agent E2E PostgreSQL 容器未在 60 秒内就绪')
}

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function cleanup(): void {
  if (cleaning) return
  cleaning = true
  try {
    docker(['rm', '--force', postgresContainer])
  } catch {
    // 容器可能因 --rm 已被删除。
  }
}

process.once('SIGINT', () => {
  cleanup()
  process.exit(130)
})
process.once('SIGTERM', () => {
  cleanup()
  process.exit(143)
})

try {
  process.exitCode = main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exitCode = 1
}
