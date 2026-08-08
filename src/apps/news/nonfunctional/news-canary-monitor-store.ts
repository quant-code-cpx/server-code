import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { chmod, mkdir, open, readFile, rename, stat, unlink, utimes } from 'node:fs/promises'
import type { NewsCanaryMonitorState } from './news-canary-monitor'

const LOCK_FILE_NAME = '.monitor.lock'
const LOCK_STALE_MS = 120_000
const LOCK_HEARTBEAT_MS = 30_000

export async function writeNewsCanaryMonitorState(path: string, state: NewsCanaryMonitorState): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`)
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8')
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

export async function readNewsCanaryMonitorState(path: string): Promise<NewsCanaryMonitorState> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (!isNewsCanaryMonitorState(parsed)) throw new Error('Canary monitor 状态文件不符合 schemaVersion 1')
  return parsed
}

export async function acquireNewsCanaryMonitorLock(directory: string): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const path = join(directory, LOCK_FILE_NAME)
  const token = randomUUID()
  const acquired = await tryAcquire(path, token)
  if (!acquired) {
    const lockStat = await stat(path).catch(() => null)
    if (lockStat && Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
      await unlink(path).catch(() => undefined)
      if (!(await tryAcquire(path, token))) throw new Error('已有 Canary monitor 运行')
    } else {
      throw new Error('已有 Canary monitor 运行')
    }
  }

  const heartbeat = setInterval(() => {
    const now = new Date()
    void utimes(path, now, now).catch(() => undefined)
  }, LOCK_HEARTBEAT_MS)
  heartbeat.unref()
  let released = false
  return async () => {
    if (released) return
    released = true
    clearInterval(heartbeat)
    const current = await readLockToken(path)
    if (current === token) await unlink(path).catch(() => undefined)
  }
}

async function tryAcquire(path: string, token: string): Promise<boolean> {
  try {
    const handle = await open(path, 'wx', 0o600)
    try {
      await handle.writeFile(
        `${JSON.stringify({ token, pid: process.pid, hostname: hostname(), acquiredAt: new Date().toISOString() })}\n`,
        'utf8',
      )
      await handle.sync()
    } finally {
      await handle.close()
    }
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') return false
    throw error
  }
}

async function readLockToken(path: string): Promise<string | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { token?: unknown }
    return typeof value.token === 'string' ? value.token : null
  } catch {
    return null
  }
}

function isNewsCanaryMonitorState(value: unknown): value is NewsCanaryMonitorState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Partial<NewsCanaryMonitorState>
  return (
    state.schemaVersion === 1 &&
    state.timezone === 'Asia/Shanghai' &&
    typeof state.updatedAt === 'string' &&
    isProviderState(state.providers?.AKSHARE) &&
    isProviderState(state.providers?.GDELT)
  )
}

function isProviderState(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  return (
    (state.nextDueAt === null || typeof state.nextDueAt === 'string') &&
    Number.isInteger(state.consecutiveSuccessfulObservationDays) &&
    Array.isArray(state.observations)
  )
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error)
}
