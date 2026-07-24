import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Prisma, PrismaClient } from '@prisma/client'

export interface TemporaryAgentDatabase {
  databaseName: string
  databaseUrl: string
  admin: PrismaClient
  dispose(): Promise<void>
}

export async function createTemporaryAgentDatabase(): Promise<TemporaryAgentDatabase> {
  const baseUrl = new URL(resolveBaseDatabaseUrl())
  if (
    !new Set(['localhost', '127.0.0.1', '[::1]']).has(baseUrl.hostname) &&
    process.env.AGENT_DB_TEST_ALLOW_REMOTE !== 'true'
  ) {
    throw new Error('Agent MVP E2E 默认只允许本机 PostgreSQL')
  }
  const databaseName = `quant_agent_mvp_e2e_${process.pid}_${Date.now()}`
  if (!/^quant_agent_mvp_e2e_\d+_\d+$/.test(databaseName)) throw new Error('临时数据库名称不安全')
  const adminUrl = new URL(baseUrl)
  adminUrl.pathname = '/postgres'
  adminUrl.search = ''
  const databaseUrl = new URL(baseUrl)
  databaseUrl.pathname = `/${databaseName}`
  databaseUrl.search = ''
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } })
  await admin.$connect()
  await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
  execFileSync(join(process.cwd(), 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    stdio: 'pipe',
    timeout: 180_000,
  })
  return {
    databaseName,
    databaseUrl: databaseUrl.toString(),
    admin,
    async dispose() {
      await admin.$queryRaw(
        Prisma.sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${databaseName} AND pid <> pg_backend_pid()`,
      )
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}"`)
      await admin.$disconnect()
    },
  }
}

function resolveBaseDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const envPath = join(process.cwd(), '.env')
  if (!existsSync(envPath)) throw new Error('Agent MVP E2E 需要 DATABASE_URL 或本地 .env')
  const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(?:"([^"]+)"|([^#\r\n]+))/m)
  const databaseUrl = match?.[1] ?? match?.[2]?.trim()
  if (!databaseUrl) throw new Error('无法从 .env 解析 DATABASE_URL')
  return databaseUrl
}
