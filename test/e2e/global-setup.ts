/**
 * E2E 全局初始化 — Prisma 迁移 + 环境检查
 */
import { execSync } from 'child_process'

export default async function globalSetup() {
  const e2eDb = process.env.E2E_DATABASE_URL
  if (!e2eDb) {
    throw new Error('E2E_DATABASE_URL 未配置，请在 .env.test 中设置')
  }
  console.log('[E2E Setup] 运行 Prisma 迁移...')
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: e2eDb },
    stdio: 'inherit',
  })
  console.log('[E2E Setup] 完成')
}
