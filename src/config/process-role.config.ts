import { ConfigType, registerAs } from '@nestjs/config'

export const PROCESS_ROLE_CONFIG_TOKEN = 'processRole'
export const PROCESS_ROLES = ['api', 'agent-worker', 'scheduler', 'all'] as const

export type ProcessRole = (typeof PROCESS_ROLES)[number]

export interface ProcessRoleEnvironment {
  PROCESS_ROLE?: string
  NODE_ENV?: string
}

export function buildProcessRoleConfig(env: ProcessRoleEnvironment) {
  const fallback: ProcessRole = env.NODE_ENV === 'production' ? 'api' : 'all'
  const role = (env.PROCESS_ROLE?.trim() || fallback) as ProcessRole
  if (!PROCESS_ROLES.includes(role)) {
    throw new Error(`[ProcessRole] PROCESS_ROLE 必须是 ${PROCESS_ROLES.join('|')}`)
  }
  return {
    role,
    apiEnabled: role === 'api' || role === 'all',
    agentWorkerEnabled: role === 'agent-worker' || role === 'all',
    schedulerEnabled: role === 'scheduler' || role === 'all',
  }
}

export function assertProcessEntrypoint(entrypoint: 'api' | 'agent-worker', role: ProcessRole): void {
  const enabled = entrypoint === 'api' ? role === 'api' || role === 'all' : role === 'agent-worker' || role === 'all'
  if (!enabled) throw new Error(`[ProcessRole] ${entrypoint} 入口不允许 PROCESS_ROLE=${role}`)
}

export const ProcessRoleConfig = registerAs(PROCESS_ROLE_CONFIG_TOKEN, () => buildProcessRoleConfig(process.env))
export type IProcessRoleConfig = ConfigType<typeof ProcessRoleConfig>
