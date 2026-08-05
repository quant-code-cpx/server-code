import { MacroResearchToolFacade } from '../macro-research-tool.facade'

describe('MacroResearchToolFacade', () => {
  const repository = {
    findCpi: jest.fn(async () => [
      {
        month: '202602',
        ntVal: 101,
        ntYoy: 1.2,
        ntMom: 0.1,
        ntAccu: 100.5,
        townYoy: 1.1,
        cntYoy: 1.3,
        syncedAt: new Date('2026-03-10T01:00:00Z'),
      },
      {
        month: '202601',
        ntVal: 100,
        ntYoy: 1,
        ntMom: 0,
        ntAccu: 100,
        townYoy: 0.9,
        cntYoy: 1.1,
        syncedAt: new Date('2026-02-10T01:00:00Z'),
      },
    ]),
    findPpi: jest.fn(async () => []),
    findGdp: jest.fn(async () => []),
    findShibor: jest.fn(async () => []),
  }
  const facade = new MacroResearchToolFacade(repository as never)

  it('历史按 period 升序返回，并明确官方发布日期不可用', async () => {
    const result = await facade.getSnapshot({ series: ['CPI'], sections: ['LATEST', 'HISTORY'], historyLimit: 2 })

    expect(result.data.history.status).toBe('OK')
    if (result.data.history.status === 'OK') {
      expect(result.data.history.data.CPI.map((item) => item.period)).toEqual(['202601', '202602'])
      expect(result.data.history.data.CPI[0]).toMatchObject({
        officialPublicationDate: null,
        systemKnownAt: '2026-02-10T01:00:00.000Z',
      })
    }
    expect(result.warnings[0].code).toBe('OFFICIAL_PUBLICATION_DATE_UNAVAILABLE')
  })

  it('多序列携带单一格式 period 时拒绝，避免歧义', async () => {
    await expect(facade.getSnapshot({ series: ['CPI', 'GDP'], startPeriod: '202601' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
  })
})
