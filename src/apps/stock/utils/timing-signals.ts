/**
 * timing-signals.ts
 *
 * 择时信号生成与综合评分逻辑
 * 输入为已计算完毕的 TechnicalDataPoint[]，输出信号列表与评分摘要
 */

import { TechnicalDataPoint } from './technical-indicators'

export interface TimingSignalItem {
  tradeDate: string
  type: 'buy' | 'sell' | 'warning'
  strength: number // 1-5
  source: string
  description: string
  closePrice: number | null
}

export interface TimingScoreDetail {
  indicator: string
  signal: 'bullish' | 'bearish' | 'neutral'
  score: number // 0-100
  reason: string
}

export interface TimingScoreSummary {
  score: number // 0-100
  rating: string
  bullishCount: number
  bearishCount: number
  neutralCount: number
  details: TimingScoreDetail[]
}

// ─── 信号检测 ─────────────────────────────────────────────────────────────────

function isValidNumber(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v)
}

/** 检测最近 lookback 根 bar 内的穿越事件 */
function detectRecentCross(
  fast: (number | null)[],
  slow: (number | null)[],
  lookback: number,
): 'golden_cross' | 'death_cross' | null {
  const n = fast.length
  for (let i = n - 1; i >= Math.max(1, n - lookback); i--) {
    const fn = fast[i]
    const sn = slow[i]
    const fp = fast[i - 1]
    const sp = slow[i - 1]
    if (!isValidNumber(fn) || !isValidNumber(sn) || !isValidNumber(fp) || !isValidNumber(sp)) continue
    if (fp <= sp && fn > sn) return 'golden_cross'
    if (fp >= sp && fn < sn) return 'death_cross'
  }
  return null
}

// ─── 信号生成 ─────────────────────────────────────────────────────────────────

export function generateTimingSignals(points: TechnicalDataPoint[], lookbackDays: number): TimingSignalItem[] {
  const signals: TimingSignalItem[] = []
  const n = points.length
  const start = Math.max(1, n - lookbackDays)

  for (let i = start; i < n; i++) {
    const p = points[i]
    const prev = points[i - 1]

    // ── MACD 金叉/死叉 ──
    if (isValidNumber(p.macdDif) && isValidNumber(p.macdDea) && isValidNumber(prev.macdDif) && isValidNumber(prev.macdDea)) {
      if (prev.macdDif <= prev.macdDea && p.macdDif > p.macdDea) {
        signals.push({
          tradeDate: p.tradeDate,
          type: 'buy',
          strength: p.macdDif > 0 ? 4 : 3,
          source: 'MACD',
          description: `MACD 金叉（DIF 上穿 DEA${p.macdDif > 0 ? '，零轴上方' : ''}）`,
          closePrice: p.close,
        })
      } else if (prev.macdDif >= prev.macdDea && p.macdDif < p.macdDea) {
        signals.push({
          tradeDate: p.tradeDate,
          type: 'sell',
          strength: p.macdDif < 0 ? 4 : 3,
          source: 'MACD',
          description: `MACD 死叉（DIF 下穿 DEA${p.macdDif < 0 ? '，零轴下方' : ''}）`,
          closePrice: p.close,
        })
      }
    }

    // ── KDJ 金叉/死叉 ──
    if (
      isValidNumber(p.kdjK) && isValidNumber(p.kdjD) &&
      isValidNumber(prev.kdjK) && isValidNumber(prev.kdjD)
    ) {
      if (prev.kdjK <= prev.kdjD && p.kdjK > p.kdjD) {
        const inLowZone = p.kdjK < 30
        signals.push({
          tradeDate: p.tradeDate,
          type: 'buy',
          strength: inLowZone ? 4 : 2,
          source: 'KDJ',
          description: `KDJ 金叉${inLowZone ? '（超卖区，信号较强）' : ''}`,
          closePrice: p.close,
        })
      } else if (prev.kdjK >= prev.kdjD && p.kdjK < p.kdjD) {
        const inHighZone = p.kdjK > 70
        signals.push({
          tradeDate: p.tradeDate,
          type: 'sell',
          strength: inHighZone ? 4 : 2,
          source: 'KDJ',
          description: `KDJ 死叉${inHighZone ? '（超买区，信号较强）' : ''}`,
          closePrice: p.close,
        })
      }
    }

    // ── RSI 超买超卖 ──
    if (isValidNumber(p.rsi6) && isValidNumber(prev.rsi6)) {
      if (prev.rsi6 < 20 && p.rsi6 >= 20) {
        signals.push({
          tradeDate: p.tradeDate,
          type: 'buy',
          strength: 3,
          source: 'RSI',
          description: `RSI6 从超卖区（<20）回升，可能反弹`,
          closePrice: p.close,
        })
      } else if (prev.rsi6 > 80 && p.rsi6 <= 80) {
        signals.push({
          tradeDate: p.tradeDate,
          type: 'sell',
          strength: 3,
          source: 'RSI',
          description: `RSI6 从超买区（>80）回落`,
          closePrice: p.close,
        })
      }
    }

    // ── BOLL 突破 ──
    if (isValidNumber(p.close) && isValidNumber(p.bollUpper) && isValidNumber(p.bollLower)) {
      if (isValidNumber(prev.close) && isValidNumber(prev.bollLower)) {
        if (prev.close >= prev.bollLower && p.close < p.bollLower) {
          signals.push({
            tradeDate: p.tradeDate,
            type: 'warning',
            strength: 3,
            source: 'BOLL',
            description: `价格跌破布林下轨，注意超卖风险`,
            closePrice: p.close,
          })
        } else if (isValidNumber(prev.bollUpper) && prev.close <= prev.bollUpper && p.close > p.bollUpper) {
          signals.push({
            tradeDate: p.tradeDate,
            type: 'sell',
            strength: 2,
            source: 'BOLL',
            description: `价格突破布林上轨，注意超买风险`,
            closePrice: p.close,
          })
        }
      }
    }

    // ── MA 金叉/死叉 ──
    if (
      isValidNumber(p.ma5) && isValidNumber(p.ma10) &&
      isValidNumber(prev.ma5) && isValidNumber(prev.ma10)
    ) {
      if (prev.ma5 <= prev.ma10 && p.ma5 > p.ma10) {
        signals.push({
          tradeDate: p.tradeDate,
          type: 'buy',
          strength: 3,
          source: 'MA_CROSS',
          description: `MA5 上穿 MA10，均线金叉`,
          closePrice: p.close,
        })
      } else if (prev.ma5 >= prev.ma10 && p.ma5 < p.ma10) {
        signals.push({
          tradeDate: p.tradeDate,
          type: 'sell',
          strength: 3,
          source: 'MA_CROSS',
          description: `MA5 下穿 MA10，均线死叉`,
          closePrice: p.close,
        })
      }
    }

    // ── SAR 翻转 ──
    if (p.sarBullish !== null && prev.sarBullish !== null) {
      if (!prev.sarBullish && p.sarBullish) {
        signals.push({
          tradeDate: p.tradeDate,
          type: 'buy',
          strength: 3,
          source: 'SAR',
          description: `SAR 抛物线翻多，趋势转强`,
          closePrice: p.close,
        })
      } else if (prev.sarBullish && !p.sarBullish) {
        signals.push({
          tradeDate: p.tradeDate,
          type: 'sell',
          strength: 3,
          source: 'SAR',
          description: `SAR 抛物线翻空，趋势转弱`,
          closePrice: p.close,
        })
      }
    }

    // ── 量价背离 ──
    if (
      isValidNumber(p.close) && isValidNumber(prev.close) &&
      isValidNumber(p.vol) && isValidNumber(p.volMa5)
    ) {
      const priceUp = p.close > prev.close
      const volUp = (p.vol as number) > (p.volMa5 as number) * 1.5
      const volShrink = (p.vol as number) < (p.volMa5 as number) * 0.5

      if (priceUp && volShrink) {
        signals.push({
          tradeDate: p.tradeDate,
          type: 'warning',
          strength: 2,
          source: 'VOLUME',
          description: `价格上涨但成交量明显萎缩，量价背离`,
          closePrice: p.close,
        })
      } else if (!priceUp && volUp) {
        signals.push({
          tradeDate: p.tradeDate,
          type: 'warning',
          strength: 2,
          source: 'VOLUME',
          description: `价格下跌但成交量放大，注意抛压`,
          closePrice: p.close,
        })
      }
    }
  }

  // 按日期降序排列
  return signals.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
}

// ─── 综合评分 ─────────────────────────────────────────────────────────────────

/** 基于最新技术指标生成综合择时评分 */
export function calcTimingScore(points: TechnicalDataPoint[]): TimingScoreSummary {
  if (points.length === 0) {
    return { score: 50, rating: '中性', bullishCount: 0, bearishCount: 0, neutralCount: 0, details: [] }
  }

  const p = points[points.length - 1]
  const details: TimingScoreDetail[] = []

  // ── MA 趋势 ──
  if (isValidNumber(p.ma5) && isValidNumber(p.ma10) && isValidNumber(p.ma20) && isValidNumber(p.ma60)) {
    const bullAlign = p.ma5 > p.ma10 && p.ma10 > p.ma20 && p.ma20 > p.ma60
    const bearAlign = p.ma5 < p.ma10 && p.ma10 < p.ma20 && p.ma20 < p.ma60
    if (bullAlign) {
      details.push({ indicator: 'MA', signal: 'bullish', score: 80, reason: '均线多头排列（MA5>MA10>MA20>MA60）' })
    } else if (bearAlign) {
      details.push({ indicator: 'MA', signal: 'bearish', score: 20, reason: '均线空头排列（MA5<MA10<MA20<MA60）' })
    } else {
      const aboveMa20 = isValidNumber(p.close) && p.close > p.ma20
      details.push({
        indicator: 'MA',
        signal: aboveMa20 ? 'bullish' : 'bearish',
        score: aboveMa20 ? 60 : 40,
        reason: aboveMa20 ? '价格站上 MA20' : '价格跌破 MA20，均线盘整',
      })
    }
  } else {
    details.push({ indicator: 'MA', signal: 'neutral', score: 50, reason: '均线数据不足' })
  }

  // ── MACD ──
  if (isValidNumber(p.macdDif) && isValidNumber(p.macdDea) && isValidNumber(p.macdHist)) {
    const difAboveDea = p.macdDif > p.macdDea
    const difAboveZero = p.macdDif > 0
    const histPositive = p.macdHist > 0

    if (difAboveZero && difAboveDea && histPositive) {
      details.push({ indicator: 'MACD', signal: 'bullish', score: 80, reason: 'DIF>DEA>0，MACD 强势多头' })
    } else if (!difAboveZero && !difAboveDea && !histPositive) {
      details.push({ indicator: 'MACD', signal: 'bearish', score: 20, reason: 'DIF<DEA<0，MACD 空头格局' })
    } else if (difAboveDea) {
      details.push({ indicator: 'MACD', signal: 'bullish', score: 65, reason: 'DIF 在 DEA 上方，偏多' })
    } else {
      details.push({ indicator: 'MACD', signal: 'bearish', score: 35, reason: 'DIF 在 DEA 下方，偏空' })
    }
  } else {
    details.push({ indicator: 'MACD', signal: 'neutral', score: 50, reason: 'MACD 数据不足' })
  }

  // ── KDJ ──
  if (isValidNumber(p.kdjK) && isValidNumber(p.kdjD) && isValidNumber(p.kdjJ)) {
    if (p.kdjJ > 100) {
      details.push({ indicator: 'KDJ', signal: 'bearish', score: 25, reason: `KDJ J 值 ${p.kdjJ.toFixed(1)} 超买` })
    } else if (p.kdjJ < 0) {
      details.push({ indicator: 'KDJ', signal: 'bullish', score: 75, reason: `KDJ J 值 ${p.kdjJ.toFixed(1)} 超卖，可能反弹` })
    } else if (p.kdjK > p.kdjD && p.kdjK > 50) {
      details.push({ indicator: 'KDJ', signal: 'bullish', score: 70, reason: 'KDJ K>D，偏强多头' })
    } else if (p.kdjK < p.kdjD && p.kdjK < 50) {
      details.push({ indicator: 'KDJ', signal: 'bearish', score: 30, reason: 'KDJ K<D，偏弱空头' })
    } else {
      details.push({ indicator: 'KDJ', signal: 'neutral', score: 50, reason: 'KDJ 中性区间' })
    }
  } else {
    details.push({ indicator: 'KDJ', signal: 'neutral', score: 50, reason: 'KDJ 数据不足' })
  }

  // ── RSI ──
  if (isValidNumber(p.rsi6)) {
    if (p.rsi6 > 80) {
      details.push({ indicator: 'RSI', signal: 'bearish', score: 20, reason: `RSI6 = ${p.rsi6.toFixed(1)}，超买` })
    } else if (p.rsi6 < 20) {
      details.push({ indicator: 'RSI', signal: 'bullish', score: 80, reason: `RSI6 = ${p.rsi6.toFixed(1)}，超卖可能反弹` })
    } else if (p.rsi6 > 50) {
      details.push({ indicator: 'RSI', signal: 'bullish', score: 60, reason: `RSI6 = ${p.rsi6.toFixed(1)}，偏强` })
    } else {
      details.push({ indicator: 'RSI', signal: 'bearish', score: 40, reason: `RSI6 = ${p.rsi6.toFixed(1)}，偏弱` })
    }
  } else {
    details.push({ indicator: 'RSI', signal: 'neutral', score: 50, reason: 'RSI 数据不足' })
  }

  // ── BOLL ──
  if (isValidNumber(p.close) && isValidNumber(p.bollUpper) && isValidNumber(p.bollMid) && isValidNumber(p.bollLower)) {
    if (p.close > p.bollUpper) {
      details.push({ indicator: 'BOLL', signal: 'bearish', score: 25, reason: '价格突破布林上轨，超买风险' })
    } else if (p.close < p.bollLower) {
      details.push({ indicator: 'BOLL', signal: 'bullish', score: 75, reason: '价格跌破布林下轨，超卖' })
    } else if (p.close > p.bollMid) {
      details.push({ indicator: 'BOLL', signal: 'bullish', score: 60, reason: '价格在布林中轨上方，偏强' })
    } else {
      details.push({ indicator: 'BOLL', signal: 'bearish', score: 40, reason: '价格在布林中轨下方，偏弱' })
    }
  } else {
    details.push({ indicator: 'BOLL', signal: 'neutral', score: 50, reason: 'BOLL 数据不足' })
  }

  // ── WR ──
  if (isValidNumber(p.wr6)) {
    if (p.wr6 > -20) {
      details.push({ indicator: 'WR', signal: 'bearish', score: 25, reason: `WR6 = ${p.wr6.toFixed(1)}，超买区` })
    } else if (p.wr6 < -80) {
      details.push({ indicator: 'WR', signal: 'bullish', score: 75, reason: `WR6 = ${p.wr6.toFixed(1)}，超卖区` })
    } else {
      details.push({ indicator: 'WR', signal: 'neutral', score: 50, reason: `WR6 = ${p.wr6.toFixed(1)}，中性` })
    }
  } else {
    details.push({ indicator: 'WR', signal: 'neutral', score: 50, reason: 'WR 数据不足' })
  }

  // ── CCI ──
  if (isValidNumber(p.cci)) {
    if (p.cci > 100) {
      details.push({ indicator: 'CCI', signal: 'bullish', score: 70, reason: `CCI = ${p.cci.toFixed(1)}，超买区强势` })
    } else if (p.cci < -100) {
      details.push({ indicator: 'CCI', signal: 'bearish', score: 30, reason: `CCI = ${p.cci.toFixed(1)}，超卖区弱势` })
    } else {
      details.push({ indicator: 'CCI', signal: 'neutral', score: 50, reason: `CCI = ${p.cci.toFixed(1)}，中性` })
    }
  } else {
    details.push({ indicator: 'CCI', signal: 'neutral', score: 50, reason: 'CCI 数据不足' })
  }

  // ── DMI ──
  if (isValidNumber(p.dmiPdi) && isValidNumber(p.dmiMdi) && isValidNumber(p.dmiAdx)) {
    const bullishTrend = p.dmiPdi > p.dmiMdi && p.dmiAdx > 25
    const bearishTrend = p.dmiPdi < p.dmiMdi && p.dmiAdx > 25
    if (bullishTrend) {
      details.push({ indicator: 'DMI', signal: 'bullish', score: 75, reason: `+DI>${p.dmiPdi.toFixed(1)} > -DI=${p.dmiMdi.toFixed(1)}，ADX=${p.dmiAdx.toFixed(1)}，多头趋势` })
    } else if (bearishTrend) {
      details.push({ indicator: 'DMI', signal: 'bearish', score: 25, reason: `+DI=${p.dmiPdi.toFixed(1)} < -DI=${p.dmiMdi.toFixed(1)}，ADX=${p.dmiAdx.toFixed(1)}，空头趋势` })
    } else {
      details.push({ indicator: 'DMI', signal: 'neutral', score: 50, reason: `ADX=${p.dmiAdx.toFixed(1)}，无明确趋势` })
    }
  } else {
    details.push({ indicator: 'DMI', signal: 'neutral', score: 50, reason: 'DMI 数据不足' })
  }

  // ── SAR ──
  if (p.sarBullish !== null) {
    if (p.sarBullish) {
      details.push({ indicator: 'SAR', signal: 'bullish', score: 65, reason: 'SAR 抛物线多头，价格在 SAR 上方' })
    } else {
      details.push({ indicator: 'SAR', signal: 'bearish', score: 35, reason: 'SAR 抛物线空头，价格在 SAR 下方' })
    }
  } else {
    details.push({ indicator: 'SAR', signal: 'neutral', score: 50, reason: 'SAR 数据不足' })
  }

  // ── 量价 ──
  if (isValidNumber(p.vol) && isValidNumber(p.volMa5) && isValidNumber(p.close)) {
    const volRatio = p.vol / (p.volMa5 as number)
    if (volRatio > 1.5 && isValidNumber(p.pctChg) && (p.pctChg as number) > 1) {
      details.push({ indicator: 'VOL', signal: 'bullish', score: 70, reason: `量价齐升，成交量放大 ${volRatio.toFixed(1)} 倍` })
    } else if (volRatio > 1.5 && isValidNumber(p.pctChg) && (p.pctChg as number) < -1) {
      details.push({ indicator: 'VOL', signal: 'bearish', score: 30, reason: `量价配合下跌，成交量放大 ${volRatio.toFixed(1)} 倍` })
    } else if (volRatio < 0.5) {
      details.push({ indicator: 'VOL', signal: 'neutral', score: 50, reason: '成交量萎缩，市场观望' })
    } else {
      details.push({ indicator: 'VOL', signal: 'neutral', score: 50, reason: '量价关系中性' })
    }
  } else {
    details.push({ indicator: 'VOL', signal: 'neutral', score: 50, reason: '量价数据不足' })
  }

  // ── 汇总评分 ──
  const totalScore = details.reduce((a, d) => a + d.score, 0)
  const avgScore = Math.round(totalScore / details.length)
  const bullishCount = details.filter((d) => d.signal === 'bullish').length
  const bearishCount = details.filter((d) => d.signal === 'bearish').length
  const neutralCount = details.filter((d) => d.signal === 'neutral').length

  let rating: string
  if (avgScore >= 75) rating = '强烈看多'
  else if (avgScore >= 60) rating = '看多'
  else if (avgScore >= 40) rating = '中性'
  else if (avgScore >= 25) rating = '看空'
  else rating = '强烈看空'

  return {
    score: avgScore,
    rating,
    bullishCount,
    bearishCount,
    neutralCount,
    details,
  }
}
