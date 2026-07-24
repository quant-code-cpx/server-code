import { MODULE_METADATA } from '@nestjs/common/constants'

type ProcessorModules = {
  backtestProcessor: unknown
  eventProcessor: unknown
  queueProviders: unknown[]
  screenerProcessor: unknown
  screenerProviders: unknown[]
  eventProviders: unknown[]
}

describe('Generic BullMQ processor process-role gate', () => {
  const originalProcessRole = process.env.PROCESS_ROLE

  afterEach(() => {
    if (originalProcessRole === undefined) delete process.env.PROCESS_ROLE
    else process.env.PROCESS_ROLE = originalProcessRole
    jest.resetModules()
  })

  it.each(['api', 'agent-worker', 'scheduler'])('%s role does not register generic processors', (role) => {
    const modules = loadProcessorModulesForRole(role)

    expect(modules.queueProviders).not.toContain(modules.backtestProcessor)
    expect(modules.eventProviders).not.toContain(modules.eventProcessor)
    expect(modules.screenerProviders).not.toContain(modules.screenerProcessor)
  })

  it('worker role registers every generic processor', () => {
    const modules = loadProcessorModulesForRole('worker')

    expect(modules.queueProviders).toContain(modules.backtestProcessor)
    expect(modules.eventProviders).toContain(modules.eventProcessor)
    expect(modules.screenerProviders).toContain(modules.screenerProcessor)
  })
})

function loadProcessorModulesForRole(role: string): ProcessorModules {
  let modules: ProcessorModules | undefined

  process.env.PROCESS_ROLE = role
  jest.isolateModules(() => {
    // Require inside isolateModules so decorator metadata reflects this role.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EventStudyModule } = require('src/apps/event-study/event-study.module')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EventSignalScanProcessor } = require('src/apps/event-study/event-signal-scan.processor')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ScreenerSubscriptionModule } = require('src/apps/screener-subscription/screener-subscription.module')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ScreenerSubscriptionProcessor } = require('src/apps/screener-subscription/screener-subscription.processor')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { QueueModule } = require('src/queue/queue.module')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BacktestingProcessor } = require('src/queue/backtesting/backtesting.processor')

    modules = {
      backtestProcessor: BacktestingProcessor,
      eventProcessor: EventSignalScanProcessor,
      eventProviders: Reflect.getMetadata(MODULE_METADATA.PROVIDERS, EventStudyModule),
      queueProviders: Reflect.getMetadata(MODULE_METADATA.PROVIDERS, QueueModule),
      screenerProcessor: ScreenerSubscriptionProcessor,
      screenerProviders: Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ScreenerSubscriptionModule),
    }
  })

  if (!modules) throw new Error('无法读取 processor module metadata')
  return modules
}
