import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { JwtService } from '@nestjs/jwt'
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { nanoid } from 'nanoid'

async function main(): Promise<void> {
  const runId = parseRunId(process.env.NEWS_FAULT_RUN_ID)
  const schema = process.env.NEWS_FAULT_DATABASE_SCHEMA?.trim() ?? ''
  assertSchema(schema, process.env.DATABASE_URL)
  const reportDirectory = resolve(process.cwd(), process.env.NEWS_PERF_REPORT_DIR?.trim() || 'storage/news-performance')
  const tokenPath = resolveReportPath(reportDirectory, `${runId}-access-token`)
  const secret = process.env.ACCESS_TOKEN_SECRET?.trim() ?? ''
  if (secret.length < 32) throw new Error('ACCESS_TOKEN_SECRET 必须至少 32 字符')
  const account = `news_fault_${runId.replace(/[^a-z0-9]+/g, '_')}`.slice(0, 80)
  const prisma = new PrismaClient()
  try {
    const user = await prisma.user.upsert({
      where: { account },
      update: { status: 'ACTIVE', role: 'SUPER_ADMIN' },
      create: {
        account,
        nickname: '新闻故障注入专用管理员',
        password: await bcrypt.hash(randomUUID(), 12),
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
    })
    const token = await new JwtService().signAsync(
      { id: user.id, account: user.account, nickname: user.nickname, role: user.role, jti: nanoid() },
      { secret, expiresIn: 3_600 },
    )
    await writeSecretAtomic(tokenPath, token)
    process.stdout.write(`${JSON.stringify({ status: 'READY', runId, tokenPath })}\n`)
  } finally {
    await prisma.$disconnect()
  }
}

function parseRunId(raw: string | undefined): string {
  const value = raw?.trim() ?? ''
  if (!/^news-fault-[a-z0-9][a-z0-9-]{0,63}$/.test(value))
    throw new Error('NEWS_FAULT_RUN_ID 必须使用 news-fault- 前缀')
  return value
}

function assertSchema(expected: string, rawUrl: string | undefined): void {
  if (!/^news_perf_fault_[a-z0-9_]{1,40}$/.test(expected) || expected === 'public') {
    throw new Error('NEWS_FAULT_DATABASE_SCHEMA 必须使用 news_perf_fault_* 隔离 schema')
  }
  if (!rawUrl) throw new Error('DATABASE_URL 不能为空')
  const parsed = new URL(rawUrl)
  if (parsed.searchParams.get('schema') !== expected)
    throw new Error('DATABASE_URL 与 NEWS_FAULT_DATABASE_SCHEMA 不一致')
}

function resolveReportPath(directory: string, filename: string): string {
  const path = resolve(directory, filename)
  if (!path.startsWith(`${directory}${sep}`)) throw new Error('故障注入 token 必须位于报告目录')
  return path
}

async function writeSecretAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(`${value}\n`, 'utf8')
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
  const message = error instanceof Error ? error.message : '故障注入用户准备失败'
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorCode: 'NEWS_FAULT_PREPARE_FAILED', message })}\n`)
  process.exitCode = 1
})
