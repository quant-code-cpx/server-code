import { SubscriptionFrequency } from '@prisma/client'
import { ScreenerSubscriptionJobName } from 'src/constant/queue.constant'
import { ScreenerSubscriptionScheduler } from '../screener-subscription.scheduler'

describe('ScreenerSubscriptionScheduler', () => {
  let queue: { add: jest.Mock }
  let subscriptionService: { getDispatchFrequencies: jest.Mock; retryDataNotReadyRuns: jest.Mock }
  let cronLock: { runIfScheduler: jest.Mock }
  let scheduler: ScreenerSubscriptionScheduler

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue({ id: 'batch-1' }) }
    subscriptionService = { getDispatchFrequencies: jest.fn(), retryDataNotReadyRuns: jest.fn().mockResolvedValue(0) }
    cronLock = { runIfScheduler: jest.fn(async (_key: string, task: () => Promise<void>) => task()) }
    scheduler = new ScreenerSubscriptionScheduler(queue as never, subscriptionService as never, cronLock as never)
  })

  afterEach(() => jest.clearAllMocks())

  it('休市日不获取分布式锁，也不投递批次', async () => {
    subscriptionService.getDispatchFrequencies.mockResolvedValue(null)

    await scheduler.dispatchForTradeDate()

    expect(cronLock.runIfScheduler).not.toHaveBeenCalled()
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('最后交易日按服务给出的交易日投递日、周、月频批次', async () => {
    subscriptionService.getDispatchFrequencies.mockResolvedValue({
      tradeDate: '20260831',
      frequencies: [SubscriptionFrequency.DAILY, SubscriptionFrequency.WEEKLY, SubscriptionFrequency.MONTHLY],
    })

    await scheduler.dispatchForTradeDate()

    expect(cronLock.runIfScheduler).toHaveBeenCalledWith('screener-subscription:20260831', expect.any(Function))
    expect(queue.add).toHaveBeenNthCalledWith(
      1,
      ScreenerSubscriptionJobName.BATCH_EXECUTE,
      { frequency: SubscriptionFrequency.DAILY, tradeDate: '20260831' },
      expect.objectContaining({ jobId: 'screener-subscription-batch-DAILY-20260831' }),
    )
    expect(queue.add).toHaveBeenNthCalledWith(
      2,
      ScreenerSubscriptionJobName.BATCH_EXECUTE,
      { frequency: SubscriptionFrequency.WEEKLY, tradeDate: '20260831' },
      expect.objectContaining({ jobId: 'screener-subscription-batch-WEEKLY-20260831' }),
    )
    expect(queue.add).toHaveBeenNthCalledWith(
      3,
      ScreenerSubscriptionJobName.BATCH_EXECUTE,
      { frequency: SubscriptionFrequency.MONTHLY, tradeDate: '20260831' },
      expect.objectContaining({ jobId: 'screener-subscription-batch-MONTHLY-20260831' }),
    )
  })

  it('未取得 scheduler lease 时不重复投递同一交易日批次', async () => {
    subscriptionService.getDispatchFrequencies.mockResolvedValue({
      tradeDate: '20260807',
      frequencies: [SubscriptionFrequency.DAILY, SubscriptionFrequency.WEEKLY],
    })
    cronLock.runIfScheduler.mockResolvedValue('skipped')

    await scheduler.dispatchForTradeDate()

    expect(queue.add).not.toHaveBeenCalled()
  })

  it('数据未就绪补偿走独立 scheduler lock，并委托 service 重投递同一 runKey', async () => {
    subscriptionService.retryDataNotReadyRuns.mockResolvedValue(2)

    await scheduler.retryDataNotReadyAfterFiveAndFifteenMinutes()

    expect(subscriptionService.retryDataNotReadyRuns).toHaveBeenCalledTimes(1)
    expect(cronLock.runIfScheduler).toHaveBeenCalledWith(
      expect.stringMatching(/^screener-subscription:data-recovery:/),
      expect.any(Function),
    )
  })
})
