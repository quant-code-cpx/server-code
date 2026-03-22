import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import configs from '../src/config'
import { PrismaService } from '../src/shared/prisma.service'
import { TushareApiService } from '../src/tushare/tushare-api.service'
import { TushareService } from '../src/tushare/tushare.service'
import { TushareMarketSyncService } from '../src/tushare/sync/tushare-market-sync.service'
import { TushareSyncSupportService } from '../src/tushare/sync/tushare-sync-support.service'

const AVAILABLE_DATASETS = ['daily', 'adj-factor', 'monthly'] as const

type MarketDataset = (typeof AVAILABLE_DATASETS)[number]

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.env'],
      isGlobal: true,
      load: [...Object.values(configs)],
    }),
  ],
  providers: [PrismaService, TushareService, TushareApiService, TushareSyncSupportService, TushareMarketSyncService],
})
class MarketRepairRunnerModule {}

async function main() {
  const datasets = resolveDatasets(process.argv.slice(2))
  const app = await NestFactory.createApplicationContext(MarketRepairRunnerModule, {
    logger: ['log', 'warn', 'error'],
  })

  try {
    const prisma = app.get(PrismaService)
    const support = app.get(TushareSyncSupportService)
    const market = app.get(TushareMarketSyncService)
    const targetTradeDate = await support.resolveLatestCompletedTradeDate()

    if (!targetTradeDate) {
      throw new Error('Unable to resolve latest completed trade date for market rebuild.')
    }

    for (const dataset of datasets) {
      console.log(`\n[market-rebuild] reset ${dataset}`)
      await resetDataset(prisma, dataset)
      console.log(`[market-rebuild] sync ${dataset} -> ${targetTradeDate}`)

      switch (dataset) {
        case 'daily':
          await market.checkDailyFreshness(targetTradeDate)
          break
        case 'adj-factor':
          await market.checkAdjFactorFreshness(targetTradeDate)
          break
        case 'monthly':
          await market.checkMonthlyFreshness(targetTradeDate)
          break
      }

      console.log(`[market-rebuild] done ${dataset}`)
    }
  } finally {
    await app.close()
  }
}

function resolveDatasets(requested: string[]): MarketDataset[] {
  if (!requested.length) {
    return [...AVAILABLE_DATASETS]
  }

  const invalid = requested.filter((task): task is string => !AVAILABLE_DATASETS.includes(task as MarketDataset))
  if (invalid.length) {
    throw new Error(`Unknown dataset(s): ${invalid.join(', ')}. Allowed: ${AVAILABLE_DATASETS.join(', ')}`)
  }

  return requested as MarketDataset[]
}

async function resetDataset(prisma: PrismaService, dataset: MarketDataset) {
  switch (dataset) {
    case 'daily':
      await prisma.daily.deleteMany({})
      break
    case 'adj-factor':
      await prisma.adjFactor.deleteMany({})
      break
    case 'monthly':
      await prisma.monthly.deleteMany({})
      break
  }
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('[market-rebuild] failed', error)
    process.exit(1)
  })
