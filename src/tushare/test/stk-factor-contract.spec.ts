import { TUSHARE_STK_FACTOR_FIELDS } from 'src/constant/tushare.constant'
import { mapStkFactorRecord } from '../tushare-sync.mapper'

describe('Tushare stk_factor 字段契约', () => {
  it('[CONTRACT] 请求官方 pct_change 和四组真实指标，不再请求不存在的旧字段', () => {
    expect(TUSHARE_STK_FACTOR_FIELDS).toContain('pct_change')
    expect(TUSHARE_STK_FACTOR_FIELDS).not.toContain('pct_chg')
    for (const invalid of ['cci_14', 'cci_20', 'tr', 'atr14', 'atr20', 'vr_26']) {
      expect(TUSHARE_STK_FACTOR_FIELDS).not.toContain(invalid as never)
    }
  })

  it('[BIZ] pct_change 正确映射；未由官方基础接口返回的 CCI/ATR/VR 保持 null', () => {
    const result = mapStkFactorRecord({
      ts_code: '600089.SH',
      trade_date: '20260804',
      pct_change: 1.25,
      cci_14: 99,
      atr14: 2,
      vr_26: 3,
    })

    expect(result).toMatchObject({
      pctChg: 1.25,
      cci14: null,
      cci20: null,
      tr: null,
      atr14: null,
      atr20: null,
      vr26: null,
    })
  })
})
