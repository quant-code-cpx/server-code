import { UserRole } from '@prisma/client'
import type { JsonSchema } from '../../contracts'
import type { ToolDefinition } from '../contracts/tool-definition'
import { ToolAdapterError } from '../contracts/tool-error'

export function createSaveResearchReportToolDefinition(): ToolDefinition {
  return {
    key: 'save_research_report',
    version: 1,
    description: '将当前用户已完成且可引用的研究预览为报告。实际写入必须由用户在报告预览界面明确确认。',
    inputSchema: strictObject(
      {
        runId: { type: 'string', minLength: 1, maxLength: 32 },
      },
      ['runId'],
    ),
    outputSchema: strictObject(
      {
        requiresConfirmation: { const: true },
      },
      ['requiresConfirmation'],
    ),
    policy: {
      requiredRole: UserRole.USER,
      sideEffect: 'WRITE',
      requiresConfirmation: true,
      idempotent: true,
      timeoutMs: 10_000,
      maxAttempts: 1,
      maxRows: 1,
      costClass: 'LOW',
      allowedDataScopes: ['USER_PRIVATE'],
    },
    execute: async (_input, context) => {
      throw new ToolAdapterError('CONFIRMATION_REQUIRED', '保存研究报告必须由用户在预览界面确认', false, undefined, {
        action: 'OPEN_REPORT_PREVIEW',
        runId: context.runId,
      })
    },
    countRows: () => 1,
  }
}

function strictObject(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: 'object', additionalProperties: false, properties, required }
}
