import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  buildNewsCanaryMonitorConfig,
  createNewsCanaryMonitorState,
  runNewsCanaryMonitorCycle,
  type NewsCanaryMonitorEnvironment,
  type NewsCanaryMonitorProviderKey,
} from 'src/apps/news/nonfunctional/news-canary-monitor'
import { loadSseNewsCanaryTradingCalendar } from 'src/apps/news/nonfunctional/news-canary-trading-calendar.repository'
import {
  acquireNewsCanaryMonitorLock,
  readNewsCanaryMonitorState,
  writeNewsCanaryMonitorState,
} from 'src/apps/news/nonfunctional/news-canary-monitor-store'
import {
  runNewsProviderCanary,
  type NewsCanaryEnvironment,
  type NewsCanaryFetch,
  type NewsCanaryReport,
} from 'src/apps/news/nonfunctional/news-canary'

const fetcher: NewsCanaryFetch = async (url, init) => {
  const response = await fetch(url, init)
  return { status: response.status, json: () => response.json() }
}

async function main(): Promise<void> {
  const config = buildNewsCanaryMonitorConfig(process.env as NewsCanaryMonitorEnvironment)
  if (!config.enabled) {
    process.stdout.write(`${JSON.stringify({ status: 'DISABLED', networkRequests: 0 })}\n`)
    return
  }

  const prisma = new PrismaClient()
  let releaseLock: (() => Promise<void>) | null = null
  let stopping = false
  let wakeSleep: (() => void) | null = null
  const stop = (): void => {
    stopping = true
    wakeSleep?.()
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)

  try {
    releaseLock = await acquireNewsCanaryMonitorLock(config.stateDirectory)
    const statePath = join(config.stateDirectory, 'state.json')
    let state = await readNewsCanaryMonitorState(statePath).catch((error: unknown) => {
      if (isNodeError(error) && error.code === 'ENOENT') return createNewsCanaryMonitorState(new Date())
      throw error
    })
    do {
      const cycle = await runNewsCanaryMonitorCycle({
        config,
        state,
        now: new Date(),
        runProvider: runProviderCanary,
        loadTradingCalendar: (now) =>
          loadSseNewsCanaryTradingCalendar(
            {
              findSseCalendarEntries: ({ fromDate, toDate }) =>
                prisma.tradeCal
                  .findMany({
                    where: { exchange: 'SSE', calDate: { gte: fromDate, lte: toDate } },
                    select: { calDate: true, isOpen: true },
                    orderBy: { calDate: 'asc' },
                  })
                  .then((rows) => rows.map((row) => ({ calendarDate: row.calDate, isOpen: row.isOpen }))),
            },
            now,
          ),
      })
      state = cycle.state
      await writeNewsCanaryMonitorState(statePath, state)
      process.stdout.write(
        `${JSON.stringify({
          event: 'NEWS_CANARY_MONITOR_CYCLE',
          status: cycle.results.some((result) => ['FAILED', 'CALENDAR_UNAVAILABLE'].includes(result.status))
            ? 'DEGRADED'
            : 'HEALTHY',
          results: cycle.results,
          providers: Object.fromEntries(
            config.providers.map((providerKey) => [
              providerKey,
              {
                nextDueAt: state.providers[providerKey].nextDueAt,
                consecutiveSuccessfulObservationDays: state.providers[providerKey].consecutiveSuccessfulObservationDays,
              },
            ]),
          ),
        })}\n`,
      )
      if (config.runOnce) {
        if (cycle.results.some((result) => ['FAILED', 'CALENDAR_UNAVAILABLE'].includes(result.status))) {
          process.exitCode = 1
        }
        break
      }
      if (!stopping) {
        await new Promise<void>((resolve) => {
          wakeSleep = resolve
          const timeout = setTimeout(resolve, config.pollIntervalMs)
          const originalResolve = resolve
          wakeSleep = () => {
            clearTimeout(timeout)
            originalResolve()
          }
        })
        wakeSleep = null
      }
    } while (!stopping)
  } finally {
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
    await prisma.$disconnect()
    if (releaseLock) await releaseLock()
  }
}

async function runProviderCanary(providerKey: NewsCanaryMonitorProviderKey): Promise<NewsCanaryReport> {
  return runNewsProviderCanary({
    env: {
      ...(process.env as NewsCanaryEnvironment),
      NEWS_CANARY_ENABLED: 'true',
      NEWS_CANARY_PROVIDERS: providerKey,
    },
    fetcher,
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now: () => new Date(),
  })
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Canary monitor 启动失败'
  process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorCode: 'CANARY_MONITOR_FAILED', message })}\n`)
  process.exitCode = 1
})
