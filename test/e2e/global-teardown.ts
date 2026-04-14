/**
 * E2E 全局清理 — 清理测试数据、断开连接
 */
import { PrismaClient } from '@prisma/client'

export default async function globalTeardown() {
  if (!process.env.E2E_DATABASE_URL) return
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.E2E_DATABASE_URL } } })
  try {
    console.log('[E2E Teardown] 清理测试数据...')
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
    console.log('[E2E Teardown] 完成')
  } finally {
    await prisma.$disconnect()
  }
}
