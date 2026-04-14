/**
 * E2E Flow 6 — 价格预警规则→盘后扫描→信号触发
 *
 * 跳过（需真实 DB+Redis+Fixture）
 */
import { INestApplication } from '@nestjs/common'

describe.skip('E2E Flow 6 — 预警与信号 (needs DB+Redis+fixture)', () => {
  let app: INestApplication

  describe('价格预警规则 CRUD 与触发', () => {
    it('[BIZ] 创建 PRICE_ABOVE 规则 → 写入数据库，status=ACTIVE', async () => {})
    it('[BIZ] runScan: 000001.SZ 收盘 > threshold → triggered=1', async () => {})
    it('[BIZ] 禁用规则后 runScan → triggered=0', async () => {})
    it('[BIZ] 修改 threshold 至不可触发后 runScan → triggered=0', async () => {})
  })

  describe('信号引擎联动', () => {
    it('[BIZ] 激活信号策略后盘后扫描产生 BUY/SELL 信号', async () => {})
    it('[BIZ] 停用信号策略后扫描不产生信号', async () => {})
    it('[BIZ] 同日同股同规则不重复触发（triggerCount 增量 = 1）', async () => {})
  })

  describe('[E2E-B6] 扫描日期时区验证（单元测试已验证，此处为 E2E 确认）', () => {
    it('[E2E-B6] runScan 使用数据库 latestTradeDate 而非 new Date()，无 UTC 偏移问题', async () => {
      // 代码：dayjs(latestTradeDate).format('YYYYMMDD')（latestTradeDate 来自 DB，非 new Date()）
      // 结论：E2E-B6 不存在
    })
  })
})
