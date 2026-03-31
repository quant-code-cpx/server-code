import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'prisma/config'

const envPath = path.join(__dirname, '.env')

if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  const databaseUrlMatch = envContent.match(/^DATABASE_URL=(?:"([^"]+)"|([^#\r\n]+))/m)
  const databaseUrl = databaseUrlMatch?.[1] ?? databaseUrlMatch?.[2]?.trim()

  if (databaseUrl) {
    process.env.DATABASE_URL = databaseUrl
  }
}

/**
 * Prisma 配置文件（Prisma >= 6.6 支持）。
 *
 * 将 schema 指向 ./prisma 目录，Prisma CLI 会自动合并目录内所有 .prisma 文件，
 * 实现多文件 Schema 管理（无需 previewFeatures 标志）。
 *
 * 文件拆分约定：
 *   prisma/base.prisma      - generator & datasource（全局配置，有且仅有一份）
 *   prisma/user.prisma      - 用户相关枚举与模型
 *   prisma/tushare.prisma   - Tushare 行情、基础、同步日志等模型
 */
export default defineConfig({
  schema: path.join(__dirname, 'prisma'),
})
