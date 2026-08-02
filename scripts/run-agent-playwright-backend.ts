import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { PrismaClient, UserRole, UserStatus } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { MODEL_PROVIDER, MODEL_PROVIDERS } from 'src/apps/agent/model-gateway/model-gateway.port'
import { APP_CONFIG_TOKEN, type IAppConfig } from 'src/config/app.config'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { HttpMetricsInterceptor } from 'src/shared/metrics/http-metrics.interceptor'
import { LoggerService } from 'src/shared/logger/logger.service'
import { ScriptedModelProvider } from 'test/agent/support/scripted-model.provider'

interface AgentRealE2eState {
  apiProcessId: number
  apiUrl: string
  databaseUrl: string
  postgresContainer: string
  redisContainer: string
  redisPassword: string
  account: string
  password: string
}

const rootDir = resolve(__dirname, '..')
const statePath = resolve(rootDir, process.env.AGENT_REAL_E2E_STATE_FILE ?? '../client-code/e2e/.agent-real-state.json')
const apiPort = readInteger(process.env.AGENT_REAL_E2E_API_PORT, 3018, 'AGENT_REAL_E2E_API_PORT')
const modelDelayMs = readInteger(process.env.AGENT_REAL_E2E_MODEL_DELAY_MS, 1_200, 'AGENT_REAL_E2E_MODEL_DELAY_MS')
const suffix = `${process.pid}-${Date.now()}`
const postgresContainer = `quant-agent-real-pg-${suffix}`
const redisContainer = `quant-agent-real-redis-${suffix}`
const postgresPassword = `agent-pg-${randomUUID()}`
const redisPassword = `agent-redis-${randomUUID()}`
const account = 'agent-real-e2e'
const password = 'AgentRealE2E!2026'
let app: Awaited<ReturnType<typeof startApplication>> | null = null
let shuttingDown = false

async function main(): Promise<void> {
  rmSync(statePath, { force: true })
  startInfrastructure()
  const postgresPort = mappedPort(postgresContainer, '5432/tcp')
  const redisPort = mappedPort(redisContainer, '6379/tcp')
  const databaseUrl = `postgresql://postgres:${encodeURIComponent(postgresPassword)}@127.0.0.1:${postgresPort}/agent_real_e2e?schema=public`
  const redisUrl = `redis://default:${encodeURIComponent(redisPassword)}@127.0.0.1:${redisPort}/0`

  configureEnvironment(databaseUrl, redisPort, redisUrl)
  migrate(databaseUrl)
  await seed(databaseUrl)
  publishWorkflow(databaseUrl)
  app = await startApplication()

  const state: AgentRealE2eState = {
    apiProcessId: process.pid,
    apiUrl: `http://localhost:${apiPort}`,
    databaseUrl,
    postgresContainer,
    redisContainer,
    redisPassword,
    account,
    password,
  }
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`Agent real backend ready: ${state.apiUrl}\n`)
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
    'POSTGRES_DB=agent_real_e2e',
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
  waitForContainer(postgresContainer, ['pg_isready', '-U', 'postgres', '-d', 'agent_real_e2e'], 'PostgreSQL')
  waitForContainer(redisContainer, ['sh', '-c', `REDISCLI_AUTH='${redisPassword}' redis-cli ping`], 'Redis')
}

function configureEnvironment(databaseUrl: string, redisPort: number, redisUrl: string): void {
  Object.assign(process.env, {
    NODE_ENV: 'development',
    PROCESS_ROLE: 'all',
    PORT: String(apiPort),
    GLOBAL_PREFIX: 'api',
    DATABASE_URL: databaseUrl,
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: String(redisPort),
    REDIS_USERNAME: 'default',
    REDIS_PASSWORD: redisPassword,
    ACCESS_TOKEN_SECRET: 'agent_real_e2e_access_secret_12345678901234567890',
    REFRESH_TOKEN_SECRET: 'agent_real_e2e_refresh_secret_1234567890123456789',
    ACCESS_TOKEN_EXPIRE: '1800',
    REFRESH_TOKEN_EXPIRE: '43200',
    SUPER_ADMIN_ACCOUNT: 'agent-real-admin',
    SUPER_ADMIN_PASSWORD: 'AgentRealAdmin!2026',
    SUPER_ADMIN_NICKNAME: 'Agent Real Admin',
    TUSHARE_SYNC_ENABLED: 'false',
    TUSHARE_TOKEN: '',
    LOG_HTTP_REQUESTS: 'false',
    LOG_HTTP_BODY: 'false',
    AGENT_MODEL_PROVIDER: 'fake',
    AGENT_MODEL_DEFAULT: 'fake-deterministic-v1',
    AGENT_SEARCH_PROVIDER: 'disabled',
    AGENT_TOOLS_ENABLED: 'get_stock_overview',
    AGENT_QUEUE_REDIS_URL: redisUrl,
    AGENT_QUEUE_PREFIX: `quant:agent:real:${suffix}`,
    AGENT_WORKER_CONCURRENCY: '1',
    AGENT_RUN_LEASE_MS: '5000',
    AGENT_LEASE_HEARTBEAT_MS: '500',
    AGENT_RECONCILE_INTERVAL_MS: '1000',
    AGENT_SSE_POLL_INTERVAL_MS: '20',
    AGENT_SSE_HEARTBEAT_MS: '1000',
    AGENT_SSE_IDLE_TIMEOUT_MS: '60000',
  })
}

function migrate(databaseUrl: string): void {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
    timeout: 180_000,
  })
  process.stdout.write('Agent real E2E migrations applied\n')
}

async function seed(databaseUrl: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  const [adminPassword, userPassword] = await Promise.all([
    bcrypt.hash('AgentRealAdmin!2026', 10),
    bcrypt.hash(password, 10),
  ])
  try {
    await prisma.user.createMany({
      data: [
        {
          account: 'agent-real-admin',
          password: adminPassword,
          nickname: 'Agent Real Admin',
          role: UserRole.SUPER_ADMIN,
          status: UserStatus.ACTIVE,
        },
        {
          account,
          password: userPassword,
          nickname: 'Agent Real E2E',
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
          email: 'agent-real-e2e@example.test',
        },
      ],
    })
    const tradeDate = new Date('2026-07-17T00:00:00.000Z')
    await prisma.stockBasic.create({
      data: {
        tsCode: '600519.SH',
        symbol: '600519',
        name: '贵州茅台',
        area: '贵州',
        industry: '白酒',
        market: '主板',
      },
    })
    await prisma.daily.create({
      data: {
        tsCode: '600519.SH',
        tradeDate,
        open: 1490,
        high: 1510,
        low: 1480,
        close: 1500,
        preClose: 1488,
        change: 12,
        pctChg: 0.8065,
        vol: 8200,
        amount: 1_230_000,
      },
    })
    await prisma.dailyBasic.create({
      data: {
        tsCode: '600519.SH',
        tradeDate,
        close: 1500,
        turnoverRate: 0.65,
        pe: 24.8,
        peTtm: 25,
        pb: 8.2,
        psTtm: 11.4,
        dvTtm: 3.1,
        totalShare: 125_620,
        floatShare: 125_620,
        totalMv: 188_430_000,
        circMv: 188_430_000,
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

function publishWorkflow(databaseUrl: string): void {
  execFileSync('pnpm', ['run', 'agent:workflow:publish'], {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
    timeout: 60_000,
  })
  process.stdout.write('Agent real E2E workflow published\n')
}

async function startApplication() {
  const { AppModule } = await import('../src/app.module')
  const provider = new ScriptedModelProvider(undefined, { delayMs: modelDelayMs })
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MODEL_PROVIDER)
    .useValue(provider)
    .overrideProvider(MODEL_PROVIDERS)
    .useValue([provider])
    .compile()
  const nestApp = moduleRef.createNestApplication({ logger: ['error', 'warn'] })
  const configService = nestApp.get(ConfigService)
  const appConfig = configService.get<IAppConfig>(APP_CONFIG_TOKEN, { infer: true })
  if (!appConfig) throw new Error('Agent real E2E 缺少 app config')
  const logger = nestApp.get(LoggerService)

  nestApp.use(helmet())
  nestApp.enableCors({ origin: true, credentials: true })
  nestApp.use(cookieParser())
  nestApp.setGlobalPrefix(appConfig.globalPrefix, { exclude: ['/metrics', '/health', '/ready'] })
  nestApp.useGlobalInterceptors(new TransformInterceptor())
  nestApp.useGlobalInterceptors(nestApp.get(HttpMetricsInterceptor))
  nestApp.useGlobalFilters(new GlobalExceptionsFilter(true, logger))
  nestApp.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }))
  nestApp.enableShutdownHooks()
  await nestApp.listen(apiPort, '127.0.0.1')
  return nestApp
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
      sleep(250)
    }
  }
  throw new Error(`${label} 容器未在 60 秒内就绪`)
}

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function readInteger(raw: string | undefined, fallback: number, name: string): number {
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error(`${name} 必须是 0-65535 的整数`)
  }
  return value
}

async function shutdown(exitCode: number): Promise<never> {
  if (shuttingDown) return new Promise(() => undefined)
  shuttingDown = true
  rmSync(statePath, { force: true })
  await app?.close().catch(() => undefined)
  for (const container of [redisContainer, postgresContainer]) {
    try {
      if (existsSync('/var/run/docker.sock') || process.platform === 'darwin') {
        docker(['rm', '--force', container])
      }
    } catch {
      // Container may already be removed by --rm.
    }
  }
  process.exit(exitCode)
}

process.once('SIGINT', () => void shutdown(0))
process.once('SIGTERM', () => void shutdown(0))

void main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  await shutdown(1)
})
