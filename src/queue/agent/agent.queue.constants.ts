export const AGENT_BULL_CONFIG_KEY = 'agent'
export const AGENT_EXECUTION_QUEUE = 'agent-execution'
export const AGENT_NOTIFICATION_QUEUE = 'agent-notification'
export const AGENT_RESEARCH_REPORT_QUEUE = 'agent-research-report'
export const AGENT_RUN_JOB_NAME = 'resume-agent-run'
export const AGENT_NOTIFICATION_JOB_NAME = 'deliver-agent-notification'
export const AGENT_RESEARCH_REPORT_JOB_NAME = 'process-agent-research-report'
export const AGENT_JOB_OUTBOX_KIND = 'AGENT_RUN_EXECUTION'
export const AGENT_JOB_SCHEMA_VERSION = 1 as const
export const AGENT_RECONCILER_INTERVAL_NAME = 'agent-run-reconciler'
export const AGENT_NOTIFICATION_RECONCILER_INTERVAL_NAME = 'agent-notification-reconciler'
export const AGENT_RESEARCH_REPORT_RECONCILER_INTERVAL_NAME = 'agent-research-report-reconciler'

export function agentJobId(runId: string): string {
  return runId
}

export function notificationJobId(deliveryId: string): string {
  return `delivery-${deliveryId}`
}

export function researchReportJobId(reportId: string, action: 'RENDER' | 'CLEANUP'): string {
  return `report-${action.toLowerCase()}-${reportId}`
}
