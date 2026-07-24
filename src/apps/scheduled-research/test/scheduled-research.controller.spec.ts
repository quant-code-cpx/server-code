import { AiScheduledTaskStatus, AiScheduledTaskTrigger } from '@prisma/client'
import { ScheduledResearchController } from '../scheduled-research.controller'

describe('ScheduledResearchController', () => {
  const user = { id: 42 } as never
  const service = {
    create: jest.fn(),
    list: jest.fn(),
    detail: jest.fn(),
    update: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    delete: jest.fn(),
    runNow: jest.fn(),
    listExecutions: jest.fn(),
  }
  const controller = new ScheduledResearchController(service as never)

  beforeEach(() => jest.clearAllMocks())

  it('所有 task 操作只把 JWT user.id 传入 service', async () => {
    const create = {
      clientRequestId: 'b8276f38-9373-4b22-b985-a2c41ee90448',
      name: '收盘研究',
      trigger: AiScheduledTaskTrigger.CRON,
      cronExpression: '0 30 18 * * 1-5',
      timeZone: 'Asia/Shanghai',
      tradingDayOnly: false,
      prompt: '总结市场变化。',
      input: {},
      allowedCapabilities: ['INTERNAL_DATA'],
      requiredWatermarks: [],
      workflowKey: 'stock_research',
      workflowVersion: 1,
      modelPolicy: 'AUTO',
      preferredModel: null,
      maxCostCny: 2,
    }
    const task = { taskId: 'schedule_1', expectedVersion: 1 }
    const list = { cursor: null, limit: 30, status: AiScheduledTaskStatus.ACTIVE, includeDeleted: false }
    const run = { taskId: 'schedule_1', clientRequestId: '52a842cf-eea4-4819-a4af-7578e1ae0071' }
    const executions = { taskId: 'schedule_1', cursor: null, limit: 30 }

    await controller.create(user, create as never)
    await controller.list(user, list)
    await controller.detail(user, { taskId: task.taskId })
    await controller.update(user, { ...task, name: '更新研究' } as never)
    await controller.pause(user, task)
    await controller.resume(user, task)
    await controller.delete(user, task)
    await controller.run(user, run)
    await controller.listExecutions(user, executions)

    expect(service.create).toHaveBeenCalledWith(42, create)
    expect(service.list).toHaveBeenCalledWith(42, list)
    expect(service.detail).toHaveBeenCalledWith(42, task.taskId)
    expect(service.update).toHaveBeenCalledWith(42, expect.objectContaining(task))
    expect(service.pause).toHaveBeenCalledWith(42, task)
    expect(service.resume).toHaveBeenCalledWith(42, task)
    expect(service.delete).toHaveBeenCalledWith(42, task)
    expect(service.runNow).toHaveBeenCalledWith(42, run)
    expect(service.listExecutions).toHaveBeenCalledWith(42, executions)
  })
})
