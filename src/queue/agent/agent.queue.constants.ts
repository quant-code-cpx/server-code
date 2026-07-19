export const AGENT_BULL_CONFIG_KEY = 'agent'
export const AGENT_EXECUTION_QUEUE = 'agent-execution'
export const AGENT_RUN_JOB_NAME = 'resume-agent-run'
export const AGENT_JOB_OUTBOX_KIND = 'AGENT_RUN_EXECUTION'
export const AGENT_JOB_SCHEMA_VERSION = 1 as const
export const AGENT_RECONCILER_INTERVAL_NAME = 'agent-run-reconciler'

export function agentJobId(runId: string): string {
  return runId
}
