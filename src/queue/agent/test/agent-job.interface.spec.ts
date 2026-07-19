import { AgentJobValidationError, createAgentJob, hashAgentJob, parseAgentJob } from '../agent-job.interface'

describe('Agent job contract', () => {
  it('只接受不可变 schemaVersion + runId，并生成稳定 hash', () => {
    const job = createAgentJob('run_123')
    expect(job).toEqual({ schemaVersion: 1, runId: 'run_123' })
    expect(Object.isFrozen(job)).toBe(true)
    expect(hashAgentJob(job)).toBe(hashAgentJob(createAgentJob('run_123')))
    expect(hashAgentJob(job)).toMatch(/^[0-9a-f]{64}$/)
  })

  it.each([
    null,
    [],
    {},
    { schemaVersion: 2, runId: 'run_1' },
    { schemaVersion: 1, runId: '' },
    { schemaVersion: 1, runId: ' run_1' },
    { schemaVersion: 1, runId: 'run_1', prompt: '不得进入队列正文' },
    { schemaVersion: 1, runId: 'run_1', userId: 7 },
  ])('拒绝非法、正文或未知字段 payload：%p', (payload) => {
    expect(() => parseAgentJob(payload)).toThrow(AgentJobValidationError)
  })
})
