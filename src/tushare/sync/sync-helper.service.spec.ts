/**
 * SyncHelperService — 纯函数单元测试
 *
 * 只测试无外部 I/O 的日期运算工具方法：
 *   toDate / formatDate / addDays / compareDateString /
 *   buildMonthlyWindows / buildYearlyWindows /
 *   buildRecentQuarterPeriods / buildPendingQuarterPeriods
 *
 * 通过最小化 mock 直接 new SyncHelperService，不依赖 NestJS Test Module。
 */
import { SyncHelperService } from './sync-helper.service'

// ── 最简单的 mock 依赖 ────────────────────────────────────────────────────────

function createService(syncStartDate = '20100101', syncTimeZone = 'Asia/Shanghai') {
  const configService = {
    get: jest.fn(() => ({ syncStartDate, syncTimeZone })),
  }
  const prisma = {}
  const cacheService = {}
  // @ts-expect-error: 故意绕过 DI，只测试纯函数
  return new SyncHelperService(prisma, configService, cacheService)
}

// ═══════════════════════════════════════════════════════════════════════════════
// toDate / formatDate
// ═══════════════════════════════════════════════════════════════════════════════

describe('SyncHelperService — toDate & formatDate', () => {
  const svc = createService()

  it('toDate("20260101") → UTC Date 2026-01-01T00:00:00Z', () => {
    const d = svc.toDate('20260101')
    expect(d).toBeInstanceOf(Date)
    expect(d.toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('toDate("20251231") → UTC Date 2025-12-31', () => {
    const d = svc.toDate('20251231')
    expect(d.toISOString()).toBe('2025-12-31T00:00:00.000Z')
  })

  it('toDate("20240229") → 闰年 2024-02-29', () => {
    const d = svc.toDate('20240229')
    expect(d.toISOString()).toBe('2024-02-29T00:00:00.000Z')
  })

  it('formatDate(toDate(s)) === s — 往返一致', () => {
    for (const s of ['20260101', '20251231', '20240229', '20200101']) {
      expect(svc.formatDate(svc.toDate(s))).toBe(s)
    }
  })

  it('formatDate 保证两位月份和日期（零填充）', () => {
    const d = new Date(Date.UTC(2026, 0, 5)) // Jan 5
    expect(svc.formatDate(d)).toBe('20260105')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// addDays & compareDateString
// ═══════════════════════════════════════════════════════════════════════════════

describe('SyncHelperService — addDays & compareDateString', () => {
  const svc = createService()

  it('addDays("20260101", 1) → "20260102"', () => {
    expect(svc.addDays('20260101', 1)).toBe('20260102')
  })

  it('addDays 跨年：addDays("20251231", 1) → "20260101"', () => {
    expect(svc.addDays('20251231', 1)).toBe('20260101')
  })

  it('addDays 跨闰年二月：addDays("20240228", 1) → "20240229"', () => {
    expect(svc.addDays('20240228', 1)).toBe('20240229')
  })

  it('addDays 负数：addDays("20260101", -1) → "20251231"', () => {
    expect(svc.addDays('20260101', -1)).toBe('20251231')
  })

  it('compareDateString: 相同日期 → 0', () => {
    expect(svc.compareDateString('20260101', '20260101')).toBe(0)
  })

  it('compareDateString: left < right → -1', () => {
    expect(svc.compareDateString('20260101', '20260102')).toBe(-1)
  })

  it('compareDateString: left > right → 1', () => {
    expect(svc.compareDateString('20260102', '20260101')).toBe(1)
  })

  it('compareDateString: 跨年', () => {
    expect(svc.compareDateString('20251231', '20260101')).toBe(-1)
    expect(svc.compareDateString('20260101', '20251231')).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// buildMonthlyWindows
// ═══════════════════════════════════════════════════════════════════════════════

describe('SyncHelperService — buildMonthlyWindows', () => {
  const svc = createService()

  it('同一个月内 → 恰好 1 个窗口', () => {
    const windows = svc.buildMonthlyWindows('20260101', '20260131')
    expect(windows).toHaveLength(1)
    expect(windows[0].startDate).toBe('20260101')
    expect(windows[0].endDate).toBe('20260131')
  })

  it('跨 2 个自然月 → 2 个窗口，边界准确', () => {
    const windows = svc.buildMonthlyWindows('20260115', '20260220')
    expect(windows).toHaveLength(2)
    expect(windows[0].startDate).toBe('20260115')
    expect(windows[0].endDate).toBe('20260131')
    expect(windows[1].startDate).toBe('20260201')
    expect(windows[1].endDate).toBe('20260220')
  })

  it('跨年窗口正确分割', () => {
    const windows = svc.buildMonthlyWindows('20251201', '20260131')
    expect(windows).toHaveLength(2)
    expect(windows[0].startDate).toBe('20251201')
    expect(windows[0].endDate).toBe('20251231')
    expect(windows[1].startDate).toBe('20260101')
    expect(windows[1].endDate).toBe('20260131')
  })

  it('单日区间 → 1 个窗口，startDate = endDate', () => {
    const windows = svc.buildMonthlyWindows('20260409', '20260409')
    expect(windows).toHaveLength(1)
    expect(windows[0].startDate).toBe('20260409')
    expect(windows[0].endDate).toBe('20260409')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// buildYearlyWindows
// ═══════════════════════════════════════════════════════════════════════════════

describe('SyncHelperService — buildYearlyWindows', () => {
  const svc = createService()

  it('同一年内 → 1 个窗口', () => {
    const windows = svc.buildYearlyWindows('20260101', '20261231')
    expect(windows).toHaveLength(1)
    expect(windows[0].startDate).toBe('20260101')
    expect(windows[0].endDate).toBe('20261231')
  })

  it('跨 3 年 → 3 个窗口', () => {
    const windows = svc.buildYearlyWindows('20240601', '20260630')
    expect(windows).toHaveLength(3)
    expect(windows[0].startDate).toBe('20240601')
    expect(windows[0].endDate).toBe('20241231')
    expect(windows[1].startDate).toBe('20250101')
    expect(windows[1].endDate).toBe('20251231')
    expect(windows[2].startDate).toBe('20260101')
    expect(windows[2].endDate).toBe('20260630')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// buildRecentQuarterPeriods
// ═══════════════════════════════════════════════════════════════════════════════

describe('SyncHelperService — buildRecentQuarterPeriods', () => {
  const svc = createService()

  // 当前日期：2026-04-09（Q1 of 2026），由测试环境真实时钟决定

  it('years=1 → 当年已过去的季度（至多 4 个）', () => {
    const periods = svc.buildRecentQuarterPeriods(1)
    // 2026-04-09 是 Q2 开始，所以当前为 Q2，含 Q1
    expect(periods.length).toBeGreaterThanOrEqual(1)
    expect(periods.length).toBeLessThanOrEqual(4)
    // 所有报告期格式 YYYYMMDD
    for (const p of periods) {
      expect(p).toMatch(/^\d{4}(0331|0630|0930|1231)$/)
    }
  })

  it('years=2 → 包含去年所有季度 + 今年已过季度', () => {
    const periods = svc.buildRecentQuarterPeriods(2)
    // 去年 4 个 + 今年 ≥1 个
    expect(periods.length).toBeGreaterThanOrEqual(5)
    expect(periods.length).toBeLessThanOrEqual(8)
  })

  it('列表按时间升序排列', () => {
    const periods = svc.buildRecentQuarterPeriods(3)
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i] > periods[i - 1]).toBe(true)
    }
  })

  it('最后一个报告期不超过当前季度', () => {
    const periods = svc.buildRecentQuarterPeriods(1)
    const last = periods[periods.length - 1]
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1
    const currentQuarter = Math.ceil(currentMonth / 3)
    const quarterEnds: Record<number, string> = { 1: '0331', 2: '0630', 3: '0930', 4: '1231' }
    const maxPeriod = `${currentYear}${quarterEnds[currentQuarter]}`
    expect(last <= maxPeriod).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// buildPendingQuarterPeriods
// ═══════════════════════════════════════════════════════════════════════════════

describe('SyncHelperService — buildPendingQuarterPeriods', () => {
  const svc = createService('20200101')

  it('latestEndDate=null → 从 syncStartDate 年第 1 季度开始', () => {
    const periods = svc.buildPendingQuarterPeriods(null)
    expect(periods[0]).toBe('20200331')
  })

  it('latestEndDate=20250331 → 从 Q2 2025 开始', () => {
    const periods = svc.buildPendingQuarterPeriods('20250331')
    expect(periods[0]).toBe('20250630')
  })

  it('latestEndDate=20251231（年末）→ 从下一年 Q1 开始', () => {
    const periods = svc.buildPendingQuarterPeriods('20251231')
    expect(periods[0]).toBe('20260331')
  })

  it('结果按时间升序', () => {
    const periods = svc.buildPendingQuarterPeriods('20240101')
    for (let i = 1; i < periods.length; i++) {
      expect(periods[i] > periods[i - 1]).toBe(true)
    }
  })

  it('不包含未来超出当前季度的报告期', () => {
    const periods = svc.buildPendingQuarterPeriods(null)
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1
    const currentQuarter = Math.ceil(currentMonth / 3)
    const quarterEnds: Record<number, string> = { 1: '0331', 2: '0630', 3: '0930', 4: '1231' }
    const maxPeriod = `${currentYear}${quarterEnds[currentQuarter]}`
    for (const p of periods) {
      expect(p <= maxPeriod).toBe(true)
    }
  })
})
