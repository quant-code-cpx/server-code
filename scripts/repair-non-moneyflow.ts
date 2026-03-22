import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import configs from '../src/config'
import { PrismaService } from '../src/shared/prisma.service'
import { TushareApiService } from '../src/tushare/tushare-api.service'
import { TushareService } from '../src/tushare/tushare.service'
import { TushareFinancialPerformanceSyncService } from '../src/tushare/sync/tushare-financial-performance-sync.service'
import { TushareFinancialIndicatorSyncService } from '../src/tushare/sync/tushare-financial-indicator-sync.service'
import { TushareSyncSupportService } from '../src/tushare/sync/tushare-sync-support.service'

const AVAILABLE_TASKS = ['express', 'top10-holders', 'top10-float-holders', 'dividend'] as const

type RepairTask = (typeof AVAILABLE_TASKS)[number]

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.env'],
      isGlobal: true,
      load: [...Object.values(configs)],
    }),
  ],
  providers: [
    PrismaService,
    TushareService,
    TushareApiService,
    TushareSyncSupportService,
    TushareFinancialPerformanceSyncService,
    TushareFinancialIndicatorSyncService,
  ],
})
class RepairRunnerModule {}

async function main() {
  const requested = process.argv.slice(2)
  const tasks = resolveTasks(requested)

  const app = await NestFactory.createApplicationContext(RepairRunnerModule, {
    logger: ['log', 'warn', 'error'],
  })

  try {
    const performance = app.get(TushareFinancialPerformanceSyncService)
    const indicator = app.get(TushareFinancialIndicatorSyncService)

    for (const task of tasks) {
      console.log(`\n[repair] start ${task}`)

      switch (task) {
        case 'express':
          await performance.checkExpressFreshness()
          break
        case 'top10-holders':
          await indicator.checkTop10HoldersFreshness()
          break
        case 'top10-float-holders':
          await indicator.checkTop10FloatHoldersFreshness()
          break
        case 'dividend':
          await performance.checkDividendFreshness()
          break
      }

      console.log(`[repair] done ${task}`)
    }
  } finally {
    await app.close()
  }
}

function resolveTasks(requested: string[]): RepairTask[] {
  if (!requested.length) {
    return [...AVAILABLE_TASKS]
  }

  const invalid = requested.filter((task): task is string => !AVAILABLE_TASKS.includes(task as RepairTask))
  if (invalid.length) {
    throw new Error(`Unknown repair task(s): ${invalid.join(', ')}. Allowed: ${AVAILABLE_TASKS.join(', ')}`)
  }

  return requested as RepairTask[]
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('[repair] failed', error)
    process.exit(1)
  })
