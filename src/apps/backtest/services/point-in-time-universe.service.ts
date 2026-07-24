import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { BACKTEST_UNIVERSE_POLICY_VERSION, sha256 } from '../constants/backtest-reproducibility.constant'
import { BacktestConfig, PointInTimeUniverseSnapshot, UNIVERSE_INDEX_CODE } from '../types/backtest-engine.types'

@Injectable()
export class PointInTimeUniverseService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(config: BacktestConfig, date: Date): Promise<PointInTimeUniverseSnapshot> {
    if (config.universe === 'CUSTOM') {
      return this.snapshot(date, 'CUSTOM', config.customUniverseTsCodes ?? [])
    }

    if (config.universe === 'ALL_A') {
      const minimumListDate = new Date(date.getTime() - config.minDaysListed * 86_400_000)
      const rows = await this.prisma.stockBasic.findMany({
        where: {
          listDate: { lte: minimumListDate },
          OR: [{ delistDate: null }, { delistDate: { gt: date } }],
        },
        select: { tsCode: true },
        orderBy: { tsCode: 'asc' },
      })
      return this.snapshot(
        date,
        'ALL_A',
        rows.map((row) => row.tsCode),
      )
    }

    const indexCode = UNIVERSE_INDEX_CODE[config.universe]
    if (!indexCode) return this.snapshot(date, config.universe, [])

    const compactDate = date.toISOString().slice(0, 10).replace(/-/g, '')
    const latest = await this.prisma.indexWeight.findFirst({
      where: { indexCode, tradeDate: { lte: compactDate } },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latest) return this.snapshot(date, `INDEX:${indexCode}`, [])

    const rows = await this.prisma.indexWeight.findMany({
      where: { indexCode, tradeDate: latest.tradeDate },
      select: { conCode: true },
      orderBy: { conCode: 'asc' },
    })
    return this.snapshot(
      date,
      `INDEX:${indexCode}:${latest.tradeDate}`,
      rows.map((row) => row.conCode),
    )
  }

  private snapshot(date: Date, source: string, rawMembers: string[]): PointInTimeUniverseSnapshot {
    const members = [...new Set(rawMembers)].sort()
    return {
      date: date.toISOString().slice(0, 10),
      members,
      source,
      version: BACKTEST_UNIVERSE_POLICY_VERSION,
      hash: sha256(members.join('\n')),
    }
  }
}
