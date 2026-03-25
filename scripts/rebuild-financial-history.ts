import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { TushareSyncTask } from '@prisma/client'
import configs from '../src/config'
import { PrismaService } from '../src/shared/prisma.service'
import { TushareClient } from '../src/tushare/api/tushare-client.service'
import { FinancialApiService } from '../src/tushare/api/financial-api.service'
import { SyncHelperService } from '../src/tushare/sync/sync-helper.service'
import { FinancialSyncService } from '../src/tushare/sync/financial-sync.service'

const AVAILABLE_TASKS = ['income', 'express', 'fina-indicator', 'top10-holders', 'top10-float-holders'] as const
type RebuildTask = (typeof AVAILABLE_TASKS)[number]

const TASK_SYNC_LOG: Record<RebuildTask, TushareSyncTask> = {
  income: TushareSyncTask.INCOME,
  express: TushareSyncTask.EXPRESS,
  'fina-indicator': TushareSyncTask.FINA_INDICATOR,
  'top10-holders': TushareSyncTask.TOP10_HOLDERS,
  'top10-float-holders': TushareSyncTask.TOP10_FLOAT_HOLDERS,
}

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.env'],
      isGlobal: true,
      load: [...Object.values(configs)],
    }),
  ],
  providers: [PrismaService, TushareClient, FinancialApiService, SyncHelperService, FinancialSyncService],
})
class FinancialRebuildRunnerModule {}

async function main() {
  const { tasks, years } = resolveArgs(process.argv.slice(2))
  const app = await NestFactory.createApplicationContext(FinancialRebuildRunnerModule, {
    logger: ['log', 'warn', 'error'],
  })

  try {
    const prisma = app.get(PrismaService)
    const financial = app.get(FinancialSyncService)

    for (const task of tasks) {
      await prisma.tushareSyncLog.deleteMany({ where: { task: TASK_SYNC_LOG[task] } })
      console.log(`\n[financial-rebuild] start ${task} (${years} years)`)

      switch (task) {
        case 'income':
          await financial.rebuildIncomeRecentYears(years)
          break
        case 'express':
          await financial.rebuildExpressRecentYears(years)
          break
        case 'fina-indicator':
          await financial.rebuildFinaIndicatorRecentYears(years)
          break
        case 'top10-holders':
          await financial.rebuildTop10HoldersRecentYears(years)
          break
        case 'top10-float-holders':
          await financial.rebuildTop10FloatHoldersRecentYears(years)
          break
      }

      console.log(`[financial-rebuild] done ${task}`)
    }
  } finally {
    await app.close()
  }
}

function resolveArgs(args: string[]): { tasks: RebuildTask[]; years: number } {
  const taskArgs = args.filter((arg) => !arg.startsWith('--years='))
  const yearsArg = args.find((arg) => arg.startsWith('--years='))
  const years = yearsArg ? Number(yearsArg.slice('--years='.length)) : 15

  if (!Number.isInteger(years) || years <= 0) {
    throw new Error(`Invalid --years value: ${years}`)
  }

  if (!taskArgs.length) {
    return { tasks: [...AVAILABLE_TASKS], years }
  }

  const invalid = taskArgs.filter((task): task is string => !AVAILABLE_TASKS.includes(task as RebuildTask))
  if (invalid.length > 0) {
    throw new Error(`Unknown rebuild task(s): ${invalid.join(', ')}. Allowed: ${AVAILABLE_TASKS.join(', ')}`)
  }

  return { tasks: taskArgs as RebuildTask[], years }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[financial-rebuild] failed', error)
    process.exit(1)
  })
