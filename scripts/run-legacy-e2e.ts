import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

const rootDir = resolve(__dirname, '..')
const suffix = `${process.pid}-${Date.now()}`
const postgresContainer = `quant-legacy-e2e-pg-${suffix}`
const redisContainer = `quant-legacy-e2e-redis-${suffix}`
const postgresPassword = `legacy-pg-${randomUUID()}`
const redisPassword = `legacy-redis-${randomUUID()}`
let cleaning = false

function main(): number {
  try {
    startInfrastructure()
    const postgresPort = mappedPort(postgresContainer, '5432/tcp')
    const redisPort = mappedPort(redisContainer, '6379/tcp')
    const databaseUrl = `postgresql://postgres:${encodeURIComponent(postgresPassword)}@127.0.0.1:${postgresPort}/legacy_e2e?schema=public`

    const env = {
      ...process.env,
      NODE_ENV: 'test',
      E2E_DATABASE_URL: databaseUrl,
      DATABASE_URL: databaseUrl,
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: String(redisPort),
      REDIS_USERNAME: 'default',
      REDIS_PASSWORD: redisPassword,
      ACCESS_TOKEN_SECRET: 'legacy_e2e_access_secret_12345678901234567890',
      REFRESH_TOKEN_SECRET: 'legacy_e2e_refresh_secret_1234567890123456789',
      ACCESS_TOKEN_EXPIRE: '120',
      REFRESH_TOKEN_EXPIRE: '300',
      TUSHARE_SYNC_ENABLED: 'false',
      TUSHARE_TOKEN: '',
    }
    const args = ['exec', 'jest', '--config', './test/jest-legacy-e2e.json', '--runInBand', ...process.argv.slice(2)]
    const result = spawnSync('pnpm', args, { cwd: rootDir, env, stdio: 'inherit' })
    if (result.error) throw result.error
    return result.status ?? 1
  } finally {
    cleanup()
  }
}

function startInfrastructure(): void {
  docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    postgresContainer,
    '--env',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    '--env',
    'POSTGRES_DB=legacy_e2e',
    '--publish',
    '127.0.0.1::5432',
    'postgres:16-alpine',
  ])
  docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    redisContainer,
    '--publish',
    '127.0.0.1::6379',
    'redis:7-alpine',
    'redis-server',
    '--save',
    '',
    '--appendonly',
    'no',
    '--requirepass',
    redisPassword,
  ])
  waitForContainer(postgresContainer, ['pg_isready', '-U', 'postgres', '-d', 'legacy_e2e'], 'PostgreSQL')
  waitForContainer(redisContainer, ['sh', '-c', `REDISCLI_AUTH='${redisPassword}' redis-cli ping`], 'Redis')
}

function mappedPort(container: string, internalPort: string): number {
  const output = docker(['port', container, internalPort]).trim()
  const match = output.match(/:(\d+)$/m)
  if (!match) throw new Error(`无法解析 ${container} 端口：${output}`)
  return Number(match[1])
}

function waitForContainer(container: string, command: string[], label: string): void {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      execFileSync('docker', ['exec', container, ...command], { stdio: 'pipe' })
      return
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
    }
  }
  throw new Error(`${label} 容器未在 60 秒内就绪`)
}

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function cleanup(): void {
  if (cleaning) return
  cleaning = true
  for (const container of [redisContainer, postgresContainer]) {
    try {
      docker(['rm', '--force', container])
    } catch {
      // 容器可能因 --rm 已被删除。
    }
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
