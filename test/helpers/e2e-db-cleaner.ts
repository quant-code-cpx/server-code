/**
 * E2E 测试数据库清理工具
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export const E2eDbCleaner = {
  async cleanAll() {
    await prisma.backtestTrade.deleteMany()
    await prisma.backtestPositionSnapshot.deleteMany()
    await prisma.backtestRun.deleteMany()
    await prisma.portfolioHolding.deleteMany()
    await prisma.portfolio.deleteMany()
    await prisma.strategyVersion.deleteMany()
    await prisma.strategy.deleteMany()
    await prisma.priceAlertRule.deleteMany()
    await prisma.auditLog.deleteMany()
    await prisma.user.deleteMany()
  },
  async close() {
    await prisma.$disconnect()
  },
}
