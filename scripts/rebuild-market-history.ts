import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { TushareSyncTask } from '@prisma/client'
import configs from '../src/config'
import { PrismaService } from '../src/shared/prisma.service'
import { TushareClient } from '../src/tushare/api/tushare-client.service'
import { MarketApiService } from '../src/tushare/api/market-api.service'
import { SyncHelperService } from '../src/tushare/sync/sync-helper.service'
import { MarketSyncService } from '../src/tushare/sync/market-sync.service'

const AVAILABLE_DATASETS = ['daily', 'adj-factor', 'monthly'] as const

type MarketDataset = (typeof AVAILABLE_DATASETS)[number]

const DATASET_TASK: Record<MarketDataset, TushareSyncTask> = {
  daily: TushareSyncTask.DAILY,
  'adj-factor': TushareSyncTask.ADJ_FACTOR,
  monthly: TushareSyncTask.MONTHLY,
}

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.env'],
      isGlobal: true,
      load: [...Object.values(configs)],
    }),
  ],
  providers: [PrismaService, TushareClient, MarketApiService, SyncHelperService, MarketSyncService],
})
class MarketRepairRunnerModule {}

async function main() {
  const datasets = resolveDatasets(process.argv.slice(2))
  const app = await NestFactory.createApplicationContext(MarketRepairRunnerModule, {
    logger: ['log', 'warn', 'error'],
  })

  try {
    const prisma = app.get(PrismaService)
    const helper = app.get(SyncHelperService)
    const market = app.get(MarketSyncService)
    const targetTradeDate = await helper.resolveLatestCompletedTradeDate()

    if (!targetTradeDate) {
      throw new Error('Unable to resolve latest completed trade date. Is trade_cal populated?')
    }

    console.log(`[market-rebuild] target trade date: ${targetTradeDate}`)

    for (const dataset of datasets) {
      console.log(`\n[market-rebuild] clearing data: ${dataset}`)
      await resetDataset(prisma, dataset)

      // 清除同步日志，防止 isTaskSyncedToday 跳过本次重建
      await prisma.tushareSyncLog.deleteMany({ where: { task: DATASET_TASK[dataset] } })

      console.log(`[market-rebuild] syncing ${dataset} → ${targetTradeDate}`)
      switch (dataset) {
        case 'daily':
          await market.syncDaily(targetTradeDate)
          break
        case 'adj-factor':
          await market.syncAdjFactor(targetTradeDate)
          break
        case 'monthly':
          await market.syncMonthly(targetTradeDate)
          break
      }

      console.log(`[market-rebuild] done: ${dataset}`)
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
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[market-rebuild] failed', error)
    process.exit(1)
  })
