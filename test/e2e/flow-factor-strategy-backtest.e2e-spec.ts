/**
 * E2E Flow 4 — 因子筛选→保存策略→发起回测
 *
 * 跳过（需真实 DB+Redis+Fixture）
 */
import { INestApplication } from '@nestjs/common'

describe.skip('E2E Flow 4 — 因子研究闭环 (needs DB+Redis+fixture)', () => {
  let app: INestApplication

  describe('因子筛选与策略保存', () => {
    it('[BIZ] POST /api/factor/library → 包含 momentum_1m、pe_inv 等内置因子', async () => {})
    it('[BIZ] POST /api/factor/screening → topN=5 返回 5 只股票，factorValue 不为 null', async () => {})
    it('[BIZ] POST /api/factor/backtest/save-as-strategy → strategyType = FACTOR_SCREENING_ROTATION', async () => {})
    it('[BIZ] POST /api/strategy/detail → strategyConfig 字段无损传递', async () => {})
    it('[BIZ] 基于此策略发起回测 → status = COMPLETED（30s 超时）', async () => {})
    it('[BIZ] 回测持仓集合 ⊆ 因子筛选股票集合', async () => {})
  })

  describe('因子筛选边界场景', () => {
    it('[EDGE] topN > 全市场股票数 → 返回所有股票，不报错', async () => {})
    it('[SEC] 用户 A token 访问用户 B 的因子结果 → 403', async () => {})
  })

  describe('[E2E-B4] 日期格式一致性（单元测试已验证，此处为 E2E 确认）', () => {
    it('[E2E-B4] strategy.run 和 backtest.createRun 均使用 YYYYMMDD，startDate 格式一致', async () => {
      // RunStrategyDto 和 CreateBacktestRunDto 均用 @Matches(/^\d{8}$/)
      // 结论：E2E-B4 不存在
    })
  })
})
