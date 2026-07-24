import { MODULE_METADATA } from '@nestjs/common/constants'

type FeatureModuleImports = {
  factorImports: unknown[]
  noopScheduleModule: unknown
  tushareImports: unknown[]
}

describe('SchedulerRegistry process-role module scope', () => {
  const originalProcessRole = process.env.PROCESS_ROLE

  afterEach(() => {
    if (originalProcessRole === undefined) delete process.env.PROCESS_ROLE
    else process.env.PROCESS_ROLE = originalProcessRole
    jest.resetModules()
  })

  it.each(['api', 'agent-worker'])('%s role imports no-op SchedulerRegistry in every consumer module', (role) => {
    const modules = loadFeatureModulesForRole(role)

    expect(modules.tushareImports).toContain(modules.noopScheduleModule)
    expect(modules.factorImports).toContain(modules.noopScheduleModule)
  })

  it('scheduler role leaves the real SchedulerRegistry to ScheduleModule.forRoot()', () => {
    const modules = loadFeatureModulesForRole('scheduler')

    expect(modules.tushareImports).not.toContain(modules.noopScheduleModule)
    expect(modules.factorImports).not.toContain(modules.noopScheduleModule)
  })
})

function loadFeatureModulesForRole(role: string): FeatureModuleImports {
  let modules: FeatureModuleImports | undefined

  process.env.PROCESS_ROLE = role
  jest.isolateModules(() => {
    // require inside isolateModules makes decorator metadata reflect this role.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FactorModule } = require('src/apps/factor/factor.module')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NoopScheduleModule } = require('src/shared/scheduler/noop-schedule.module')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TushareModule } = require('src/tushare/tushare.module')

    modules = {
      factorImports: Reflect.getMetadata(MODULE_METADATA.IMPORTS, FactorModule),
      noopScheduleModule: NoopScheduleModule,
      tushareImports: Reflect.getMetadata(MODULE_METADATA.IMPORTS, TushareModule),
    }
  })

  if (!modules) throw new Error('无法读取功能模块 metadata')
  return modules
}
