import { Test, TestingModule } from '@nestjs/testing'
import { Job } from 'bullmq'
import { EventStudyJobName } from 'src/constant/queue.constant'
import { EventSignalScanProcessor } from '../event-signal-scan.processor'
import { EventSignalService } from '../event-signal.service'
import { EventSignalScanJobData, EventSignalScanJobResult } from '../event-signal-scan.types'

function makeJob(
  name: string,
  data: EventSignalScanJobData,
): jest.Mocked<Job<EventSignalScanJobData, EventSignalScanJobResult>> {
  return {
    id: 'job-1',
    name,
    data,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Job<EventSignalScanJobData, EventSignalScanJobResult>>
}

describe('EventSignalScanProcessor', () => {
  let processor: EventSignalScanProcessor
  let eventSignalService: jest.Mocked<EventSignalService>

  beforeEach(async () => {
    eventSignalService = {
      scanAndGenerate: jest.fn().mockResolvedValue({ signalsGenerated: 3 }),
    } as unknown as jest.Mocked<EventSignalService>

    const module: TestingModule = await Test.createTestingModule({
      providers: [EventSignalScanProcessor, { provide: EventSignalService, useValue: eventSignalService }],
    }).compile()

    processor = module.get(EventSignalScanProcessor)
  })

  afterEach(() => jest.clearAllMocks())

  it('process(scan-signal-rules) — 执行扫描并返回结果', async () => {
    const job = makeJob(EventStudyJobName.SCAN_SIGNAL_RULES, {
      tradeDate: '20240115',
      requestedByUserId: 1,
      requestedAt: '2024-01-15T09:00:00.000Z',
    })

    const result = await processor.process(job)

    expect(eventSignalService.scanAndGenerate).toHaveBeenCalledWith('20240115')
    expect(job.updateProgress).toHaveBeenNthCalledWith(1, 10)
    expect(job.updateProgress).toHaveBeenNthCalledWith(2, 100)
    expect(result).toMatchObject({ tradeDate: '20240115', signalsGenerated: 3 })
    expect(result.completedAt).toBeDefined()
  })

  it('process(unknown-job) — 抛出错误', async () => {
    const job = makeJob('unknown-job', {
      tradeDate: '20240115',
      requestedByUserId: 1,
      requestedAt: '2024-01-15T09:00:00.000Z',
    })

    await expect(processor.process(job)).rejects.toThrow('Unknown event-study job name')
    expect(eventSignalService.scanAndGenerate).not.toHaveBeenCalled()
  })
})
