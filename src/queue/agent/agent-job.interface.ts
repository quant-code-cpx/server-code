import { createHash } from 'node:crypto'
import { AGENT_JOB_SCHEMA_VERSION } from './agent.queue.constants'

export interface AgentJob {
  schemaVersion: typeof AGENT_JOB_SCHEMA_VERSION
  runId: string
}

export class AgentJobValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = AgentJobValidationError.name
  }
}

export function createAgentJob(runId: string): AgentJob {
  return parseAgentJob({ schemaVersion: AGENT_JOB_SCHEMA_VERSION, runId })
}

export function parseAgentJob(value: unknown): AgentJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentJobValidationError('Agent job payload 必须是对象')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.length !== 2 || keys[0] !== 'runId' || keys[1] !== 'schemaVersion') {
    throw new AgentJobValidationError('Agent job payload 只允许 schemaVersion、runId')
  }
  if (record.schemaVersion !== AGENT_JOB_SCHEMA_VERSION) {
    throw new AgentJobValidationError(`Agent job schemaVersion 必须是 ${AGENT_JOB_SCHEMA_VERSION}`)
  }
  if (
    typeof record.runId !== 'string' ||
    record.runId.trim() !== record.runId ||
    !record.runId ||
    record.runId.length > 32
  ) {
    throw new AgentJobValidationError('Agent job runId 必须是 1-32 字符非空字符串')
  }
  return Object.freeze({ schemaVersion: AGENT_JOB_SCHEMA_VERSION, runId: record.runId })
}

export function hashAgentJob(job: AgentJob): string {
  return createHash('sha256')
    .update(JSON.stringify({ schemaVersion: job.schemaVersion, runId: job.runId }))
    .digest('hex')
}
