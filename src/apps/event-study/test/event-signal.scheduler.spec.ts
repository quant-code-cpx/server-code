import { EventStudyJobName } from 'src/constant/queue.constant'
import { EventSignalScheduler } from '../event-signal.scheduler'

describe('EventSignalScheduler', () => {
  it('scheduler tick only enqueues scan work under a distributed lease', async () => {
    const eventSignalService = {
      enqueueScan: jest.fn().mockResolvedValue({ jobId: 'scan-1', status: 'QUEUED', tradeDate: '20260722' }),
    }
    const cronLock = {
      runIfScheduler: jest.fn(async (_key: string, task: () => Promise<void>) => await task()),
    }
    const scheduler = new EventSignalScheduler(eventSignalService as never, cronLock as never)

    await scheduler.dailyScan()

    expect(cronLock.runIfScheduler).toHaveBeenCalledWith('event-signal:daily', expect.any(Function))
    expect(eventSignalService.enqueueScan).toHaveBeenCalledWith(undefined)
    expect(EventStudyJobName.SCAN_SIGNAL_RULES).toBe('scan-signal-rules')
  })

  it('does not enqueue when this process does not acquire the lease', async () => {
    const eventSignalService = { enqueueScan: jest.fn() }
    const cronLock = { runIfScheduler: jest.fn().mockResolvedValue('skipped') }
    const scheduler = new EventSignalScheduler(eventSignalService as never, cronLock as never)

    await scheduler.dailyScan()

    expect(eventSignalService.enqueueScan).not.toHaveBeenCalled()
  })
})
