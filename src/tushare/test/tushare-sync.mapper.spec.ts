/**
 * tushare-sync.mapper — 单元测试
 *
 * 覆盖要点：
 * - mapDailyRecord: 字段映射、日期解析、空值处理、缺失 PK 返回 null
 * - mapStockBasicRecord: 基础字段映射、缺失 ts_code 返回 null
 * - mapMoneyflowRecord: 资金流字段映射
 * - mapDailyBasicRecord: 每日指标字段映射
 * - mapAdjFactorRecord: 复权因子字段映射
 * - readDate / readNumber 行为通过导出函数间接验证
 */

import {
  mapAdjFactorRecord,
  mapDailyBasicRecord,
  mapDailyRecord,
  mapMoneyflowRecord,
  mapStockBasicRecord,
  mapMoneyflowIndDcRecord,
  mapMoneyflowMktDcRecord,
  mapTradeCalRecord,
} from 'src/tushare/tushare-sync.mapper'

// ValidationCollector 为可选参数，单元测试中传入 undefined 即可
// 部分函数需要 collector（非 undefined）才会做验证，这里不测验证分支

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

/** 构造最小合法日线记录 */
function dailyRecord(overrides: Record<string, unknown> = {}) {
  return {
    ts_code: '000001.SZ',
    trade_date: '20240101',
    open: '10.50',
    high: '11.00',
    low: '10.20',
    close: '10.80',
    pre_close: '10.40',
    change: '0.40',
    pct_chg: '3.85',
    vol: '123456.78',
    amount: '1234567.89',
    ...overrides,
  }
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('tushare-sync.mapper', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── readDate 行为（通过 mapDailyRecord 间接验证）────────────────────────────

  describe('readDate（通过导出函数间接验证）', () => {
    it('YYYYMMDD → 对应 UTC Date 对象', () => {
      const result = mapDailyRecord(dailyRecord({ trade_date: '20240101' }))
      expect(result).not.toBeNull()
      expect(result!.tradeDate).toEqual(new Date(Date.UTC(2024, 0, 1)))
    })

    it('空字符串 trade_date → 返回 null（缺少 PK）', () => {
      const result = mapDailyRecord(dailyRecord({ trade_date: '' }))
      expect(result).toBeNull()
    })

    it('非 8 位字符串 → 返回 null（缺少 PK）', () => {
      const result = mapDailyRecord(dailyRecord({ trade_date: '2024-01-01' }))
      expect(result).toBeNull()
    })

    it('null trade_date → 返回 null（缺少 PK）', () => {
      const result = mapDailyRecord(dailyRecord({ trade_date: null }))
      expect(result).toBeNull()
    })
  })

  // ── readNumber 行为（通过 mapDailyRecord 间接验证）──────────────────────────

  describe('readNumber（通过导出函数间接验证）', () => {
    it('数字字符串 "123.45" → 对应 number 值', () => {
      const result = mapDailyRecord(dailyRecord({ close: '123.45' }))
      expect(result).not.toBeNull()
      expect(result!.close).toBe(123.45)
    })

    it('空字符串 "" → null', () => {
      const result = mapDailyRecord(dailyRecord({ close: '' }))
      expect(result).not.toBeNull()
      expect(result!.close).toBeNull()
    })

    it('null → null', () => {
      const result = mapDailyRecord(dailyRecord({ close: null }))
      expect(result).not.toBeNull()
      expect(result!.close).toBeNull()
    })

    it('undefined → null', () => {
      const result = mapDailyRecord(dailyRecord({ close: undefined }))
      expect(result).not.toBeNull()
      expect(result!.close).toBeNull()
    })
  })

  // ── mapDailyRecord ─────────────────────────────────────────────────────────

  describe('mapDailyRecord()', () => {
    it('应正确映射所有 OHLCV 字段', () => {
      const result = mapDailyRecord(dailyRecord())
      expect(result).not.toBeNull()
      expect(result).toMatchObject({
        tsCode: '000001.SZ',
        tradeDate: new Date(Date.UTC(2024, 0, 1)),
        open: 10.5,
        high: 11.0,
        low: 10.2,
        close: 10.8,
        preClose: 10.4,
        vol: 123456.78,
        amount: 1234567.89,
      })
    })

    it('ts_code 缺失时应返回 null', () => {
      const result = mapDailyRecord(dailyRecord({ ts_code: '' }))
      expect(result).toBeNull()
    })

    it('trade_date 缺失时应返回 null', () => {
      const result = mapDailyRecord(dailyRecord({ trade_date: '' }))
      expect(result).toBeNull()
    })

    it('数值字段为空字符串时应映射为 null', () => {
      const result = mapDailyRecord(
        dailyRecord({ open: '', high: '', low: '', close: '', vol: '', amount: '' }),
      )
      expect(result).not.toBeNull()
      expect(result!.open).toBeNull()
      expect(result!.high).toBeNull()
      expect(result!.low).toBeNull()
      expect(result!.close).toBeNull()
      expect(result!.vol).toBeNull()
      expect(result!.amount).toBeNull()
    })

    it('不传 collector 时不应抛出异常', () => {
      expect(() => mapDailyRecord(dailyRecord(), undefined)).not.toThrow()
    })
  })

  // ── mapStockBasicRecord ────────────────────────────────────────────────────

  describe('mapStockBasicRecord()', () => {
    const basicRecord = () => ({
      ts_code: '000001.SZ',
      symbol: '000001',
      name: '平安银行',
      area: '深圳',
      industry: '银行',
      fullname: '平安银行股份有限公司',
      enname: 'PING AN BANK',
      cnspell: 'PAYH',
      market: '主板',
      exchange: 'SZSE',
      curr_type: 'CNY',
      list_status: 'L',
      list_date: '19910403',
      delist_date: '',
      is_hs: 'S',
      act_name: '',
      act_ent_type: '',
    })

    it('应正确映射基础字段', () => {
      const result = mapStockBasicRecord(basicRecord())
      expect(result).not.toBeNull()
      expect(result!.tsCode).toBe('000001.SZ')
      expect(result!.name).toBe('平安银行')
      expect(result!.area).toBe('深圳')
    })

    it('list_date 应正确解析为 Date', () => {
      const result = mapStockBasicRecord(basicRecord())
      expect(result).not.toBeNull()
      expect(result!.listDate).toEqual(new Date(Date.UTC(1991, 3, 3)))
    })

    it('ts_code 缺失时应返回 null', () => {
      const result = mapStockBasicRecord({ ...basicRecord(), ts_code: '' })
      expect(result).toBeNull()
    })

    it('可选字段为空字符串时应返回 null', () => {
      const result = mapStockBasicRecord({ ...basicRecord(), delist_date: '' })
      expect(result).not.toBeNull()
      expect(result!.delistDate).toBeNull()
    })
  })

  // ── mapDailyBasicRecord ────────────────────────────────────────────────────

  describe('mapDailyBasicRecord()', () => {
    const basicRec = () => ({
      ts_code: '000001.SZ',
      trade_date: '20240101',
      close: '10.80',
      turnover_rate: '1.23',
      turnover_rate_f: '2.34',
      volume_ratio: '1.00',
      pe: '9.5',
      pe_ttm: '8.7',
      pb: '1.2',
      ps: '2.3',
      ps_ttm: '2.1',
      dv_ratio: '',
      dv_ttm: '',
      total_share: '1938000',
      float_share: '1800000',
      free_share: '1600000',
      total_mv: '2093040',
      circ_mv: '1944000',
      limit_status: '0',
    })

    it('应正确映射所有字段', () => {
      const result = mapDailyBasicRecord(basicRec())
      expect(result).not.toBeNull()
      expect(result!.tsCode).toBe('000001.SZ')
      expect(result!.close).toBe(10.8)
      expect(result!.pe).toBe(9.5)
      expect(result!.pb).toBe(1.2)
    })

    it('dv_ratio 为空字符串时应映射为 null', () => {
      const result = mapDailyBasicRecord(basicRec())
      expect(result).not.toBeNull()
      expect(result!.dvRatio).toBeNull()
    })

    it('ts_code 缺失时应返回 null', () => {
      const result = mapDailyBasicRecord({ ...basicRec(), ts_code: '' })
      expect(result).toBeNull()
    })
  })

  // ── mapAdjFactorRecord ─────────────────────────────────────────────────────

  describe('mapAdjFactorRecord()', () => {
    it('应正确映射 ts_code、trade_date、adj_factor', () => {
      const result = mapAdjFactorRecord({
        ts_code: '000001.SZ',
        trade_date: '20240101',
        adj_factor: '1.234567',
      })
      expect(result).not.toBeNull()
      expect(result!.tsCode).toBe('000001.SZ')
      expect(result!.tradeDate).toEqual(new Date(Date.UTC(2024, 0, 1)))
      expect(result!.adjFactor).toBe(1.234567)
    })

    it('ts_code 缺失时应返回 null', () => {
      const result = mapAdjFactorRecord({ ts_code: '', trade_date: '20240101', adj_factor: '1.0' })
      expect(result).toBeNull()
    })

    it('trade_date 缺失时应返回 null', () => {
      const result = mapAdjFactorRecord({ ts_code: '000001.SZ', trade_date: '', adj_factor: '1.0' })
      expect(result).toBeNull()
    })
  })

  // ── mapMoneyflowRecord ─────────────────────────────────────────────────────

  describe('mapMoneyflowRecord()', () => {
    const mfRecord = () => ({
      ts_code: '000001.SZ',
      trade_date: '20240101',
      buy_sm_vol: '100',
      buy_sm_amount: '50.5',
      sell_sm_vol: '80',
      sell_sm_amount: '40.0',
      buy_md_vol: '200',
      buy_md_amount: '100.0',
      sell_md_vol: '150',
      sell_md_amount: '75.5',
      buy_lg_vol: '300',
      buy_lg_amount: '150.0',
      sell_lg_vol: '250',
      sell_lg_amount: '125.0',
      buy_elg_vol: '400',
      buy_elg_amount: '200.0',
      sell_elg_vol: '350',
      sell_elg_amount: '175.0',
      net_mf_vol: '50',
      net_mf_amount: '25.5',
    })

    it('应正确映射 ts_code 和 trade_date', () => {
      const result = mapMoneyflowRecord(mfRecord())
      expect(result).not.toBeNull()
      expect(result!.tsCode).toBe('000001.SZ')
      expect(result!.tradeDate).toEqual(new Date(Date.UTC(2024, 0, 1)))
    })

    it('应正确映射资金流字段', () => {
      const result = mapMoneyflowRecord(mfRecord())
      expect(result).not.toBeNull()
      expect(result!.buySmVol).toBe(100)
      expect(result!.buySmAmount).toBe(50.5)
      expect(result!.netMfVol).toBe(50)
      expect(result!.netMfAmount).toBe(25.5)
    })

    it('ts_code 缺失时应返回 null', () => {
      const result = mapMoneyflowRecord({ ...mfRecord(), ts_code: '' })
      expect(result).toBeNull()
    })

    it('数值字段为空时应映射为 null', () => {
      const result = mapMoneyflowRecord({ ...mfRecord(), buy_sm_vol: '', net_mf_amount: null })
      expect(result).not.toBeNull()
      expect(result!.buySmVol).toBeNull()
      expect(result!.netMfAmount).toBeNull()
    })
  })

  // ── mapTradeCalRecord ──────────────────────────────────────────────────────

  describe('mapTradeCalRecord()', () => {
    it('应正确映射交易日历字段', () => {
      const result = mapTradeCalRecord({
        exchange: 'SSE',
        cal_date: '20240101',
        is_open: '0',
        pretrade_date: '20231229',
      })
      expect(result).not.toBeNull()
      expect(result!.calDate).toEqual(new Date(Date.UTC(2024, 0, 1)))
      expect(result!.isOpen).toBe('0')
    })

    it('exchange 不合法时应返回 null', () => {
      const result = mapTradeCalRecord({
        exchange: 'UNKNOWN',
        cal_date: '20240101',
        is_open: '1',
        pretrade_date: '',
      })
      expect(result).toBeNull()
    })

    it('cal_date 缺失时应返回 null', () => {
      const result = mapTradeCalRecord({
        exchange: 'SSE',
        cal_date: '',
        is_open: '1',
        pretrade_date: '',
      })
      expect(result).toBeNull()
    })
  })
})
