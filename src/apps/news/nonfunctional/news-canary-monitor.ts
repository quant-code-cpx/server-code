import type { NewsCanaryEnvironment, NewsCanaryReport } from './news-canary'

export type NewsCanaryMonitorProviderKey = 'AKSHARE' | 'GDELT'
export type NewsCanaryMonitorCycleStatus =
  | NewsCanaryReport['status']
  | 'SKIPPED_NON_TRADING_DAY'
  | 'CALENDAR_UNAVAILABLE'

export interface NewsCanaryTradingCalendarWindow {
  exchange: 'SSE'
  entries: Array<{
    calendarDate: string
    isOpen: boolean
  }>
}

export interface NewsCanaryMonitorEnvironment extends NewsCanaryEnvironment {
  NEWS_CANARY_MONITOR_ENABLED?: string
  NEWS_CANARY_MONITOR_PROVIDERS?: string
  NEWS_CANARY_MONITOR_AKSHARE_INTERVAL_MS?: string
  NEWS_CANARY_MONITOR_GDELT_INTERVAL_MS?: string
  NEWS_CANARY_MONITOR_POLL_INTERVAL_MS?: string
  NEWS_CANARY_MONITOR_STATE_DIR?: string
  NEWS_CANARY_MONITOR_ONCE?: string
}

export interface NewsCanaryMonitorConfig {
  enabled: boolean
  providers: NewsCanaryMonitorProviderKey[]
  intervalMsByProvider: Record<NewsCanaryMonitorProviderKey, number>
  pollIntervalMs: number
  stateDirectory: string
  runOnce: boolean
}

export interface NewsCanaryMonitorProviderState {
  nextDueAt: string | null
  consecutiveSuccessfulObservationDays: number
  observations: Array<{
    observationDate: string
    status: 'PASSED' | 'FAILED'
    startedAt: string
    finishedAt: string
    evidence: NewsCanaryReport['evidence']
  }>
}

export interface NewsCanaryMonitorState {
  schemaVersion: 1
  timezone: 'Asia/Shanghai'
  updatedAt: string
  providers: Record<NewsCanaryMonitorProviderKey, NewsCanaryMonitorProviderState>
}

export function buildNewsCanaryMonitorConfig(_env: NewsCanaryMonitorEnvironment): NewsCanaryMonitorConfig {
  const enabled = parseBoolean(_env.NEWS_CANARY_MONITOR_ENABLED, false, 'NEWS_CANARY_MONITOR_ENABLED')
  const intervalMsByProvider = {
    AKSHARE: parseInteger(
      _env.NEWS_CANARY_MONITOR_AKSHARE_INTERVAL_MS,
      86_400_000,
      900_000,
      604_800_000,
      'NEWS_CANARY_MONITOR_AKSHARE_INTERVAL_MS',
    ),
    GDELT: parseInteger(
      _env.NEWS_CANARY_MONITOR_GDELT_INTERVAL_MS,
      900_000,
      900_000,
      86_400_000,
      'NEWS_CANARY_MONITOR_GDELT_INTERVAL_MS',
    ),
  }
  if (!enabled) {
    return {
      enabled: false,
      providers: [],
      intervalMsByProvider,
      pollIntervalMs: 60_000,
      stateDirectory: _env.NEWS_CANARY_MONITOR_STATE_DIR?.trim() || 'storage/news-canary',
      runOnce: false,
    }
  }
  return {
    enabled: true,
    providers: parseProviders(_env.NEWS_CANARY_MONITOR_PROVIDERS),
    intervalMsByProvider,
    pollIntervalMs: parseInteger(
      _env.NEWS_CANARY_MONITOR_POLL_INTERVAL_MS,
      60_000,
      10_000,
      900_000,
      'NEWS_CANARY_MONITOR_POLL_INTERVAL_MS',
    ),
    stateDirectory: _env.NEWS_CANARY_MONITOR_STATE_DIR?.trim() || 'storage/news-canary',
    runOnce: parseBoolean(_env.NEWS_CANARY_MONITOR_ONCE, false, 'NEWS_CANARY_MONITOR_ONCE'),
  }
}

export function createNewsCanaryMonitorState(_now: Date): NewsCanaryMonitorState {
  const updatedAt = validDate(_now, 'now').toISOString()
  const emptyProvider = (): NewsCanaryMonitorProviderState => ({
    nextDueAt: null,
    consecutiveSuccessfulObservationDays: 0,
    observations: [],
  })
  return {
    schemaVersion: 1,
    timezone: 'Asia/Shanghai',
    updatedAt,
    providers: { AKSHARE: emptyProvider(), GDELT: emptyProvider() },
  }
}

export function recordNewsCanaryObservation(
  _state: NewsCanaryMonitorState,
  _providerKey: NewsCanaryMonitorProviderKey,
  _report: NewsCanaryReport,
  _intervalMs: number,
  _tradingCalendar: NewsCanaryTradingCalendarWindow,
): NewsCanaryMonitorState {
  const finishedAt = validDate(new Date(_report.finishedAt), 'report.finishedAt')
  const tradingCalendar = normalizeTradingCalendar(_tradingCalendar)
  const providerState = _state.providers[_providerKey]
  const observations = [...providerState.observations]
  const observationDate = shanghaiCalendarDate(new Date(_report.startedAt))
  if (_report.status !== 'DISABLED') {
    const observation = {
      observationDate,
      status: _report.status,
      startedAt: _report.startedAt,
      finishedAt: _report.finishedAt,
      evidence: _report.evidence.map((item) => ({ ...item })),
    }
    const existingIndex = observations.findIndex((item) => item.observationDate === observationDate)
    if (existingIndex >= 0) observations[existingIndex] = observation
    else observations.push(observation)
    observations.sort((left, right) => left.observationDate.localeCompare(right.observationDate))
  }
  const retainedObservations = observations.slice(-30)
  return {
    ..._state,
    updatedAt: finishedAt.toISOString(),
    providers: {
      ..._state.providers,
      [_providerKey]: {
        nextDueAt:
          _providerKey === 'AKSHARE'
            ? (nextTradingDayDueAt(tradingCalendar, observationDate, finishedAt) ??
              new Date(finishedAt.getTime() + _intervalMs).toISOString())
            : new Date(finishedAt.getTime() + _intervalMs).toISOString(),
        consecutiveSuccessfulObservationDays: calculateSuccessfulStreak(retainedObservations, tradingCalendar),
        observations: retainedObservations,
      },
    },
  }
}

export async function runNewsCanaryMonitorCycle(_options: {
  config: NewsCanaryMonitorConfig
  state: NewsCanaryMonitorState
  now: Date
  runProvider: (providerKey: NewsCanaryMonitorProviderKey) => Promise<NewsCanaryReport>
  loadTradingCalendar: (now: Date) => Promise<NewsCanaryTradingCalendarWindow>
}): Promise<{
  state: NewsCanaryMonitorState
  results: Array<{ providerKey: NewsCanaryMonitorProviderKey; status: NewsCanaryMonitorCycleStatus }>
}> {
  if (!_options.config.enabled) return { state: _options.state, results: [] }
  const now = validDate(_options.now, 'now')
  let state = _options.state
  const results: Array<{ providerKey: NewsCanaryMonitorProviderKey; status: NewsCanaryMonitorCycleStatus }> = []
  const dueProviders = _options.config.providers.filter((providerKey) => {
    const nextDueAt = state.providers[providerKey].nextDueAt
    return !nextDueAt || new Date(nextDueAt).getTime() <= now.getTime()
  })
  if (dueProviders.length === 0) return { state, results }

  let tradingCalendar: NewsCanaryTradingCalendarWindow
  try {
    tradingCalendar = normalizeTradingCalendar(await _options.loadTradingCalendar(now))
    requireCalendarEntry(tradingCalendar, shanghaiCalendarDate(now))
  } catch {
    for (const providerKey of dueProviders) {
      state = rescheduleProvider(state, providerKey, new Date(now.getTime() + _options.config.pollIntervalMs), now)
      results.push({ providerKey, status: 'CALENDAR_UNAVAILABLE' })
    }
    return { state, results }
  }

  const currentCalendarDate = shanghaiCalendarDate(now)
  const currentCalendarEntry = requireCalendarEntry(tradingCalendar, currentCalendarDate)
  for (const providerKey of dueProviders) {
    if (providerKey === 'AKSHARE' && !currentCalendarEntry.isOpen) {
      const nextOpenDate = nextOpenCalendarDate(tradingCalendar, currentCalendarDate)
      if (!nextOpenDate) {
        state = rescheduleProvider(state, providerKey, new Date(now.getTime() + _options.config.pollIntervalMs), now)
        results.push({ providerKey, status: 'CALENDAR_UNAVAILABLE' })
        continue
      }
      const schedulingBasis = state.providers[providerKey].nextDueAt
        ? validDate(new Date(state.providers[providerKey].nextDueAt), 'provider.nextDueAt')
        : now
      state = rescheduleProvider(state, providerKey, new Date(atShanghaiTime(nextOpenDate, schedulingBasis)), now)
      results.push({ providerKey, status: 'SKIPPED_NON_TRADING_DAY' })
      continue
    }
    let report: NewsCanaryReport
    try {
      report = await _options.runProvider(providerKey)
    } catch {
      report = {
        schemaVersion: 1,
        status: 'FAILED',
        startedAt: now.toISOString(),
        finishedAt: now.toISOString(),
        evidence: [],
      }
    }
    state = recordNewsCanaryObservation(
      state,
      providerKey,
      report,
      _options.config.intervalMsByProvider[providerKey],
      tradingCalendar,
    )
    results.push({ providerKey, status: report.status })
  }
  return { state, results }
}

function parseProviders(raw: string | undefined): NewsCanaryMonitorProviderKey[] {
  const values = (raw?.trim() || 'AKSHARE')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (
    values.length === 0 ||
    values.some((value) => !(['AKSHARE', 'GDELT'] as const).includes(value as NewsCanaryMonitorProviderKey))
  ) {
    throw new Error('NEWS_CANARY_MONITOR_PROVIDERS 只允许 AKSHARE/GDELT')
  }
  return [...new Set(values)] as NewsCanaryMonitorProviderKey[]
}

function parseBoolean(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw == null || raw.trim() === '') return fallback
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name} 只能是 true/false`)
}

function parseInteger(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (!raw?.trim()) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 的整数`)
  }
  return value
}

function validDate(date: Date, name: string): Date {
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} 必须是合法时间`)
  return date
}

export function shanghaiCalendarDate(date: Date): string {
  validDate(date, 'observation date')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function calculateSuccessfulStreak(
  observations: NewsCanaryMonitorProviderState['observations'],
  tradingCalendar: NewsCanaryTradingCalendarWindow,
): number {
  const openDates = tradingCalendar.entries.filter((entry) => entry.isOpen).map((entry) => entry.calendarDate)
  const observationByDate = new Map(observations.map((observation) => [observation.observationDate, observation]))
  let latestObservedOpenDateIndex = -1
  for (let index = openDates.length - 1; index >= 0; index -= 1) {
    if (observationByDate.has(openDates[index])) {
      latestObservedOpenDateIndex = index
      break
    }
  }
  let streak = 0
  for (let index = latestObservedOpenDateIndex; index >= 0; index -= 1) {
    const observation = observationByDate.get(openDates[index])
    if (!observation || observation.status !== 'PASSED') break
    streak += 1
  }
  return streak
}

function normalizeTradingCalendar(calendar: NewsCanaryTradingCalendarWindow): NewsCanaryTradingCalendarWindow {
  if (calendar.exchange !== 'SSE' || !Array.isArray(calendar.entries)) throw new Error('SSE 交易日历无效')
  const entries = calendar.entries.map((entry) => {
    if (!isIsoCalendarDate(entry.calendarDate) || typeof entry.isOpen !== 'boolean') {
      throw new Error('SSE 交易日历条目无效')
    }
    return { ...entry }
  })
  entries.sort((left, right) => left.calendarDate.localeCompare(right.calendarDate))
  if (new Set(entries.map((entry) => entry.calendarDate)).size !== entries.length) {
    throw new Error('SSE 交易日历日期重复')
  }
  return { exchange: 'SSE', entries }
}

function requireCalendarEntry(
  calendar: NewsCanaryTradingCalendarWindow,
  calendarDate: string,
): NewsCanaryTradingCalendarWindow['entries'][number] {
  const entry = calendar.entries.find((candidate) => candidate.calendarDate === calendarDate)
  if (!entry) throw new Error(`SSE 交易日历缺少 ${calendarDate}`)
  return entry
}

function nextOpenCalendarDate(calendar: NewsCanaryTradingCalendarWindow, afterDate: string): string | null {
  return calendar.entries.find((entry) => entry.isOpen && entry.calendarDate > afterDate)?.calendarDate ?? null
}

function nextTradingDayDueAt(
  calendar: NewsCanaryTradingCalendarWindow,
  observationDate: string,
  finishedAt: Date,
): string | null {
  const nextOpenDate = nextOpenCalendarDate(calendar, observationDate)
  return nextOpenDate ? atShanghaiTime(nextOpenDate, finishedAt) : null
}

function atShanghaiTime(calendarDate: string, timeSource: Date): string {
  const shanghaiTime = new Date(validDate(timeSource, 'timeSource').getTime() + 8 * 60 * 60 * 1_000)
  const hours = String(shanghaiTime.getUTCHours()).padStart(2, '0')
  const minutes = String(shanghaiTime.getUTCMinutes()).padStart(2, '0')
  const seconds = String(shanghaiTime.getUTCSeconds()).padStart(2, '0')
  const milliseconds = String(shanghaiTime.getUTCMilliseconds()).padStart(3, '0')
  return validDate(
    new Date(`${calendarDate}T${hours}:${minutes}:${seconds}.${milliseconds}+08:00`),
    'next trading dueAt',
  ).toISOString()
}

function rescheduleProvider(
  state: NewsCanaryMonitorState,
  providerKey: NewsCanaryMonitorProviderKey,
  nextDueAt: Date,
  updatedAt: Date,
): NewsCanaryMonitorState {
  return {
    ...state,
    updatedAt: validDate(updatedAt, 'updatedAt').toISOString(),
    providers: {
      ...state.providers,
      [providerKey]: {
        ...state.providers[providerKey],
        nextDueAt: validDate(nextDueAt, 'nextDueAt').toISOString(),
      },
    },
  }
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
