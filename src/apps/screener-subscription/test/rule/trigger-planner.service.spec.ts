import { RuleNormalizerService } from '../../rule/rule-normalizer.service'
import { RuleSpecValidatorService } from '../../rule/rule-spec-validator.service'
import { TriggerPlannerService } from '../../rule/trigger-planner.service'

const createPlanner = () => new TriggerPlannerService(new RuleNormalizerService(new RuleSpecValidatorService()))

describe('TriggerPlannerService', () => {
  it('首次集合匹配默认只建立基线，不创建 ENTER hit', () => {
    const plan = createPlanner().planCollection({
      hasBaseline: false,
      previousMatchCodes: [],
      currentMatchCodes: ['000002.sz', '000001.SZ'],
    })

    expect(plan.isInitialBaseline).toBe(true)
    expect(plan.matchedCodes).toEqual(['000001.SZ', '000002.SZ'])
    expect(plan.observedEnterCodes).toEqual(['000001.SZ', '000002.SZ'])
    expect(plan.hits).toEqual([])
  })

  it('按 ENTER、EXIT、BOTH 产生完整差集，不截断命中', () => {
    const planner = createPlanner()
    const input = {
      hasBaseline: true,
      previousMatchCodes: ['000001.SZ', '000003.SZ'],
      currentMatchCodes: ['000002.SZ', '000003.SZ'],
    }

    expect(planner.planCollection({ ...input, triggerSpec: { mode: 'ENTER' } }).hits).toEqual([
      { tsCode: '000002.SZ', kind: 'ENTER' },
    ])
    expect(planner.planCollection({ ...input, triggerSpec: { mode: 'EXIT' } }).hits).toEqual([
      { tsCode: '000001.SZ', kind: 'EXIT' },
    ])
    expect(planner.planCollection({ ...input, triggerSpec: { mode: 'BOTH' } }).hits).toEqual([
      { tsCode: '000002.SZ', kind: 'ENTER' },
      { tsCode: '000001.SZ', kind: 'EXIT' },
    ])
  })

  it('首次执行不接受初始 ENTER 通知配置', () => {
    expect(() =>
      createPlanner().planCollection({
        hasBaseline: false,
        previousMatchCodes: [],
        currentMatchCodes: ['000001.SZ'],
        triggerSpec: { notifyOnInitialMatch: true },
      }),
    ).toThrow('B0 不支持首次执行通知')
  })
})
