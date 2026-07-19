import { Inject, Injectable } from '@nestjs/common'
import { UserStatus } from '@prisma/client'
import { ROLE_LEVEL } from 'src/constant/user.constant'
import { AgentToolsConfig, type IAgentToolsConfig } from 'src/config/agent-tools.config'
import type { ToolDefinition } from './contracts/tool-definition'
import type { ToolErrorCode } from './contracts/tool-error'
import type { ToolExecutionContext } from './tool-access-context'

export class ToolPolicyDeniedError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message)
    this.name = ToolPolicyDeniedError.name
  }
}

@Injectable()
export class ToolPolicyService {
  constructor(@Inject(AgentToolsConfig.KEY) private readonly config: IAgentToolsConfig) {}

  authorize(definition: ToolDefinition, context: ToolExecutionContext): void {
    if (!Number.isInteger(context.userId) || context.userId < 1) {
      throw new ToolPolicyDeniedError('PERMISSION_DENIED', '无权使用该 Tool')
    }
    if (context.userStatus !== UserStatus.ACTIVE) {
      throw new ToolPolicyDeniedError('PERMISSION_DENIED', '无权使用该 Tool')
    }
    if ((ROLE_LEVEL[context.role] ?? 0) < (ROLE_LEVEL[definition.policy.requiredRole] ?? Number.MAX_SAFE_INTEGER)) {
      throw new ToolPolicyDeniedError('PERMISSION_DENIED', '无权使用该 Tool')
    }
    if (!context.workflowAllowedTools.includes(definition.key)) {
      throw new ToolPolicyDeniedError('PERMISSION_DENIED', '当前工作流未授权该 Tool')
    }
    if (!definition.policy.allowedDataScopes.some((scope) => context.allowedScopes.includes(scope))) {
      throw new ToolPolicyDeniedError('PERMISSION_DENIED', '当前数据域未授权该 Tool')
    }
    if (!Number.isSafeInteger(context.callsUsed) || context.callsUsed < 0) {
      throw new ToolPolicyDeniedError('INTERNAL_ERROR', 'Tool 调用预算状态无效')
    }
    if (context.callsUsed >= this.config.maxCallsPerRun) {
      throw new ToolPolicyDeniedError('QUOTA_EXCEEDED', 'Agent Run Tool 调用次数已达上限')
    }
    if (!(context.deadlineAt instanceof Date) || Number.isNaN(context.deadlineAt.getTime())) {
      throw new ToolPolicyDeniedError('INTERNAL_ERROR', 'Agent Run deadline 无效')
    }
    if (context.deadlineAt.getTime() <= Date.now()) {
      throw new ToolPolicyDeniedError('TIMEOUT', 'Agent Run deadline 已到期')
    }
    if (definition.policy.requiresConfirmation) {
      throw new ToolPolicyDeniedError('CONFIRMATION_REQUIRED', 'Tool 需要用户明确确认')
    }
  }
}
