import { Injectable } from '@nestjs/common'
import { AiAgentRunStatus, AiAgentStepStatus } from '@prisma/client'
import { AgentRunConflictError } from './agent-execution.errors'

const RUN_TRANSITIONS: Readonly<Record<AiAgentRunStatus, readonly AiAgentRunStatus[]>> = {
  QUEUED: [AiAgentRunStatus.RUNNING, AiAgentRunStatus.CANCELLED],
  RUNNING: [AiAgentRunStatus.CANCEL_REQUESTED, AiAgentRunStatus.COMPLETED, AiAgentRunStatus.FAILED],
  CANCEL_REQUESTED: [AiAgentRunStatus.CANCELLED],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
}

const STEP_TRANSITIONS: Readonly<Record<AiAgentStepStatus, readonly AiAgentStepStatus[]>> = {
  PENDING: [AiAgentStepStatus.RUNNING, AiAgentStepStatus.CANCELLED, AiAgentStepStatus.SKIPPED],
  RUNNING: [AiAgentStepStatus.COMPLETED, AiAgentStepStatus.FAILED, AiAgentStepStatus.CANCELLED],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  SKIPPED: [],
}

const TERMINAL_RUN_STATUSES = new Set<AiAgentRunStatus>([
  AiAgentRunStatus.COMPLETED,
  AiAgentRunStatus.FAILED,
  AiAgentRunStatus.CANCELLED,
])

@Injectable()
export class AgentStateMachineService {
  allowedRunTargets(status: AiAgentRunStatus): readonly AiAgentRunStatus[] {
    return RUN_TRANSITIONS[status] ?? []
  }

  assertRunTransition(current: AiAgentRunStatus, target: AiAgentRunStatus): void {
    if (!this.allowedRunTargets(current).includes(target)) {
      throw new AgentRunConflictError(`非法 Agent Run 状态转换：${current} -> ${target}`)
    }
  }

  isTerminalRunStatus(status: AiAgentRunStatus): boolean {
    return TERMINAL_RUN_STATUSES.has(status)
  }

  assertStepTransition(current: AiAgentStepStatus, target: AiAgentStepStatus): void {
    if (!(STEP_TRANSITIONS[current] ?? []).includes(target)) {
      throw new AgentRunConflictError(`非法 Agent Step 状态转换：${current} -> ${target}`)
    }
  }
}
