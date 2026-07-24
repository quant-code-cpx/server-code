/**
 * E2E 全局初始化 — Prisma 迁移 + 环境检查
 */
import { execFileSync } from 'node:child_process'

export default async function globalSetup() {
  const e2eDb = process.env.E2E_DATABASE_URL
  if (!e2eDb) {
    throw new Error('E2E_DATABASE_URL 未配置，请在 .env.test 中设置')
  }
  const databaseUrl = new URL(e2eDb)
  if (!new Set(['localhost', '127.0.0.1', '[::1]']).has(databaseUrl.hostname)) {
    throw new Error('旧业务 E2E 默认只允许本机 PostgreSQL')
  }
  console.log('[E2E Setup] 运行 Prisma 迁移...')
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: e2eDb },
    stdio: 'pipe',
    timeout: 180_000,
  })
  console.log('[E2E Setup] 完成')
}
