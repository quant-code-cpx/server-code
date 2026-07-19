import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MARKET_PRICE_DATA_CONTRACT_VERIFIED, MARKET_PRICE_DATA_CONTRACT_VERSION } from 'src/tushare/data-contract'
import { formatCheckpoint, shouldScalePctChange } from 'src/tushare/scripts/repair-market-period-pct-change'

const migrationsDir = join(process.cwd(), 'prisma', 'migrations')
const missingTablesMigration = '20260425000000_create_missing_sync_tables'
const valuationBackfillMigration = '20260426000002_backfill_valuation_daily_medians'
const dividendMigration = '20260720000000_deduplicate_dividend_and_add_unique_key'

function migrationSql(name: string): string {
  return readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8')
}

describe('fresh migration 与数据口径门禁', () => {
  it('缺表 migration 必须早于 valuation backfill', () => {
    const migrations = readdirSync(migrationsDir).sort()

    expect(migrations.indexOf(missingTablesMigration)).toBeGreaterThanOrEqual(0)
    expect(migrations.indexOf(missingTablesMigration)).toBeLessThan(migrations.indexOf(valuationBackfillMigration))
  })

  it.each([
    'valuation_daily_medians',
    'cyq_chips',
    'cyq_perf',
    'limit_list_d',
    'fund_adj',
    'fund_portfolio',
    'fund_share',
    'ths_daily',
    'daily_info',
    'ggt_daily',
  ])('fresh migration 显式创建 %s', (tableName) => {
    expect(migrationSql(missingTablesMigration)).toContain(`CREATE TABLE IF NOT EXISTS "${tableName}"`)
  })

  it('Dividend migration 保留最新记录，并对 null 业务键去重', () => {
    const sql = migrationSql(dividendMigration)

    expect(sql).toContain('ORDER BY "synced_at" DESC, "id" DESC')
    expect(sql).toContain('NULLS NOT DISTINCT')
    expect(sql).toContain('stock_dividend_events_business_key')
  })

  it('仅修复可由 OHLC 独立验证为小数比例的记录', () => {
    expect(shouldScalePctChange({ close: 10.5, preClose: 10, pctChg: 0.05 })).toBe(true)
    expect(shouldScalePctChange({ close: 10.5, preClose: 10, pctChg: 5 })).toBe(false)
    expect(shouldScalePctChange({ close: null, preClose: 10, pctChg: 0.05 })).toBe(false)
  })

  it('repair checkpoint 可复制并用于断点恢复', () => {
    expect(formatCheckpoint({ tsCode: '000001.SZ', tradeDate: new Date('2024-01-31T00:00:00.000Z') })).toBe(
      '000001.SZ@2024-01-31',
    )
  })

  it('真实库修复验证后放开 Agent 金融 Tool 数据门禁', () => {
    expect(MARKET_PRICE_DATA_CONTRACT_VERSION).toBe('market-price-percent-v1')
    expect(MARKET_PRICE_DATA_CONTRACT_VERIFIED).toBe(true)
  })
})
