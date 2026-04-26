/**
 * AutoRepairService — 单元测试
 *
 * 覆盖要点：
 * - analyzeAndRepair: 只处理 completeness fail 报告
 * - 缺失 ≤ 30 天 → 入队重试（实际调用 prisma.tushareSyncRetryQueue.create）
 * - 缺失 > 30 天 → no-action 任务，跳过自动补数
 * - 财务类数据集（income 等无映射）→ no-action 任务
 * - 去重：PENDING 记录已存在 → 跳过
 * - fail 数量 > maxFailDataSets → logger.error
 * - taskToDataSet: 已知任务返回 dataSet 名；未知返回 null
 */

import { TushareSyncTask, TushareSyncRetryStatus } from '@prisma/client'
import { AutoRepairService } from '../auto-repair.service'
import { PrismaService } from 'src/shared/prisma.service'
import { SyncHelperService } from '../../sync-helper.service'
import { DataQualityReport } from '../data-quality.service'

// ── mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    tushareSyncRetryQueue: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
    },
  }
}

function buildHelperMock() {
  return {}
}

function createService(prisma = buildPrismaMock(), helper = buildHelperMock()): AutoRepairService {
  // @ts-ignore 局部 mock，跳过 DI
  return new AutoRepairService(prisma as PrismaService, helper as SyncHelperService)
}

// ── 辅助：构建质量报告 ──────────────────────────────────────────────────────────

function buildReport(
  partial: Partial<DataQualityReport> & Pick<DataQualityReport, 'dataSet' | 'checkType' | 'status'>,
): DataQualityReport {
  return {
    message: `${partial.dataSet} 测试报告`,
    ...partial,
  }
}

function buildCompletenessFailReport(dataSet: string, missingDates: string[]): DataQualityReport {
  return buildReport({
    dataSet,
    checkType: 'completeness',
    status: 'fail',
    details: { missingDates, totalMissing: missingDates.length },
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ══════════════════════════════════════════════════════════════════════════════

describe('AutoRepairService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ── taskToDataSet ──────────────────────────────────────────────────────────

  describe('taskToDataSet()', () => {
    it('已知 task DAILY → 返回 daily', () => {
      const service = createService()
      expect(service.taskToDataSet(TushareSyncTask.DAILY)).toBe('daily')
    })

    it('已知 task DAILY_BASIC → 返回 dailyBasic', () => {
      const service = createService()
      expect(service.taskToDataSet(TushareSyncTask.DAILY_BASIC)).toBe('dailyBasic')
    })

    it('已知 task MONEYFLOW → 返回 moneyflow', () => {
      const service = createService()
      expect(service.taskToDataSet(TushareSyncTask.MONEYFLOW)).toBe('moneyflow')
    })

    it('未知 task → 返回 null', () => {
      const service = createService()
      expect(service.taskToDataSet('UNKNOWN_TASK' as TushareSyncTask)).toBeNull()
    })
  })

  // ── analyzeAndRepair: 过滤逻辑 ─────────────────────────────────────────────

  describe('analyzeAndRepair() 过滤逻辑', () => {
    it('空报告列表 → 零任务、零执行', async () => {
      const service = createService()
      const summary = await service.analyzeAndRepair([])
      expect(summary.totalChecked).toBe(0)
      expect(summary.repairTasks).toBe(0)
      expect(summary.executed).toBe(0)
    })

    it('timeliness fail 报告 → 不生成补数任务', async () => {
      const prisma = buildPrismaMock()
      const service = createService(prisma)
      const report = buildReport({ dataSet: 'daily', checkType: 'timeliness', status: 'fail' })
      const summary = await service.analyzeAndRepair([report])
      expect(summary.repairTasks).toBe(0)
      expect(prisma.tushareSyncRetryQueue.create).not.toHaveBeenCalled()
    })

    it('completeness warn 报告（非 fail）→ 不生成补数任务', async () => {
      const prisma = buildPrismaMock()
      const service = createService(prisma)
      const report = buildReport({
        dataSet: 'daily',
        checkType: 'completeness',
        status: 'warn',
        details: { missingDates: ['20250320'], totalMissing: 1 },
      })
      const summary = await service.analyzeAndRepair([report])
      expect(summary.repairTasks).toBe(0)
    })

    it('completeness fail 但 missingDates 为空 → 跳过', async () => {
      const prisma = buildPrismaMock()
      const service = createService(prisma)
      const report = buildReport({
        dataSet: 'daily',
        checkType: 'completeness',
        status: 'fail',
        details: { missingDates: [], totalMissing: 0 },
      })
      const summary = await service.analyzeAndRepair([report])
      expect(summary.repairTasks).toBe(0)
    })
  })

  // ── analyzeAndRepair: 补数执行 ─────────────────────────────────────────────

  describe('analyzeAndRepair() 补数执行', () => {
    it('缺失 ≤ 30 天（daily）→ 为每个缺失日期创建重试队列记录', async () => {
      const prisma = buildPrismaMock()
      const service = createService(prisma)
      const missing = ['20250310', '20250311', '20250312']
      const report = buildCompletenessFailReport('daily', missing)

      const summary = await service.analyzeAndRepair([report])

      expect(summary.repairTasks).toBe(1)
      expect(summary.executed).toBe(3)
      expect(prisma.tushareSyncRetryQueue.create).toHaveBeenCalledTimes(3)
      expect(prisma.tushareSyncRetryQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            task: TushareSyncTask.DAILY,
            failedKey: '20250310',
            status: TushareSyncRetryStatus.PENDING,
          }),
        }),
      )
    })

    it('缺失 > 30 天 → 生成 no-action 任务，不入队', async () => {
      const prisma = buildPrismaMock()
      const service = createService(prisma)
      // 构造 31 个缺失日期
      const missing = Array.from({ length: 31 }, (_, i) => `2025020${String(i + 1).padStart(2, '0')}`)
        .slice(0, 31)
        .map((_, i) => {
          const d = new Date('2025-01-01')
          d.setDate(d.getDate() + i)
          return d.toISOString().slice(0, 10).replace(/-/g, '')
        })

      const report = buildCompletenessFailReport('daily', missing)
      const summary = await service.analyzeAndRepair([report])

      expect(summary.repairTasks).toBe(1)
      expect(summary.tasks[0].repairType).toBe('no-action')
      expect(summary.executed).toBe(0)
      expect(prisma.tushareSyncRetryQueue.create).not.toHaveBeenCalled()
    })

    it('财务类数据集（income）→ 无同步任务映射，生成 no-action 任务', async () => {
      const prisma = buildPrismaMock()
      const service = createService(prisma)
      const report = buildCompletenessFailReport('income', ['20241231', '20240930'])
      const summary = await service.analyzeAndRepair([report])

      expect(summary.repairTasks).toBe(1)
      expect(summary.tasks[0].repairType).toBe('no-action')
      expect(prisma.tushareSyncRetryQueue.create).not.toHaveBeenCalled()
    })

    it('多个数据集有补数 → executed 累计正确', async () => {
      const prisma = buildPrismaMock()
      const service = createService(prisma)

      const reports = [
        buildCompletenessFailReport('daily', ['20250310', '20250311']),
        buildCompletenessFailReport('adjFactor', ['20250310']),
      ]

      const summary = await service.analyzeAndRepair(reports)
      expect(summary.executed).toBe(3)
      expect(prisma.tushareSyncRetryQueue.create).toHaveBeenCalledTimes(3)
    })
  })

  // ── 去重逻辑 ───────────────────────────────────────────────────────────────

  describe('去重：PENDING 记录已存在时跳过', () => {
    it('已有 PENDING 记录 → 不重复入队', async () => {
      const prisma = buildPrismaMock()
      // findFirst 返回已有记录（表示已在队列中）
      prisma.tushareSyncRetryQueue.findFirst.mockResolvedValue({ id: 1 } as never)
      const service = createService(prisma)

      const report = buildCompletenessFailReport('daily', ['20250310', '20250311'])
      const summary = await service.analyzeAndRepair([report])

      // findFirst 被调用（检查是否存在），但 create 不被调用
      expect(prisma.tushareSyncRetryQueue.findFirst).toHaveBeenCalled()
      expect(prisma.tushareSyncRetryQueue.create).not.toHaveBeenCalled()
      expect(summary.executed).toBe(0)
    })

    it('部分日期已有记录，部分没有 → 只为新记录入队', async () => {
      const prisma = buildPrismaMock()
      // 第一次调用返回已有记录，第二次返回 null（新记录）
      prisma.tushareSyncRetryQueue.findFirst.mockResolvedValueOnce({ id: 1 } as never).mockResolvedValueOnce(null)

      const service = createService(prisma)
      const report = buildCompletenessFailReport('daily', ['20250310', '20250311'])
      const summary = await service.analyzeAndRepair([report])

      expect(prisma.tushareSyncRetryQueue.create).toHaveBeenCalledTimes(1)
      expect(summary.executed).toBe(1)
    })
  })

  // ── 告警阈值 ───────────────────────────────────────────────────────────────

  describe('告警阈值检查', () => {
    it('fail 数量 > maxFailDataSets(5) → 调用 logger.error', async () => {
      const service = createService()
      // @ts-ignore 访问私有 logger
      const loggerSpy = jest.spyOn(service['logger'], 'error')

      // 构造 6 个 fail 报告（超出阈值 5）
      const reports: DataQualityReport[] = Array.from({ length: 6 }, (_, i) =>
        buildReport({ dataSet: `dataset${i}`, checkType: 'timeliness', status: 'fail' }),
      )

      await service.analyzeAndRepair(reports)
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('超出阈值'))
    })

    it('fail 数量 ≤ maxFailDataSets(5) → 不调用 logger.error（针对数量阈值）', async () => {
      const service = createService()
      // @ts-ignore
      const loggerSpy = jest.spyOn(service['logger'], 'error')

      const reports: DataQualityReport[] = Array.from({ length: 5 }, (_, i) =>
        buildReport({ dataSet: `dataset${i}`, checkType: 'timeliness', status: 'fail' }),
      )

      await service.analyzeAndRepair(reports)
      // 5 个 fail 等于阈值，未超出，不应调用 error
      expect(loggerSpy).not.toHaveBeenCalled()
    })
  })
})
