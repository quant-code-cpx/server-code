import { AiAgentStepKind } from '@prisma/client'
import { AGENT_V6_TOOL_KEYS } from '../../contracts/tool-keys'
import type { WorkflowDefinition } from '../workflow.types'
import { RESEARCH_PLAN_SCHEMA_V2 } from './stock-research.v1'
import {
  STOCK_RESEARCH_PROMPT_V3,
  STOCK_RESEARCH_WORKFLOW_DEFINITIONS as LEGACY_STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V5,
} from './stock-research.v2'

export const RESEARCH_PLAN_SCHEMA_V3: Record<string, unknown> = Object.freeze({
  ...RESEARCH_PLAN_SCHEMA_V2,
  properties: {
    ...(RESEARCH_PLAN_SCHEMA_V2.properties as Record<string, unknown>),
    toolCalls: {
      ...((RESEARCH_PLAN_SCHEMA_V2.properties as Record<string, Record<string, unknown>>).toolCalls ?? {}),
      items: {
        ...(((RESEARCH_PLAN_SCHEMA_V2.properties as Record<string, Record<string, unknown>>).toolCalls?.items as Record<
          string,
          unknown
        >) ?? {}),
        properties: {
          ...((
            ((RESEARCH_PLAN_SCHEMA_V2.properties as Record<string, Record<string, unknown>>).toolCalls?.items as Record<
              string,
              Record<string, unknown>
            >) ?? {}
          ).properties as Record<string, unknown>),
          toolKey: { enum: [...AGENT_V6_TOOL_KEYS] },
        },
      },
    },
  },
})

export const STOCK_RESEARCH_PROMPT_V4 = Object.freeze({
  ...STOCK_RESEARCH_PROMPT_V3,
  version: 4,
  template: [
    STOCK_RESEARCH_PROMPT_V3.template,
    'Use only the tools selected by the frozen capability-catalog step.',
    'For chip cost or winner rate use get_stock_chip_profile@1; never describe an estimate as stored data.',
    'For financing or securities-lending history use get_stock_margin_history@1.',
    'For relative performance against an index use get_stock_relative_strength@1.',
    'For exact company event lookup use get_stock_events@1; do not use it for post-event return statistics.',
    'For holder counts, top holders, holder trades, or pledge status use get_stock_shareholder_profile@1.',
  ].join('\n'),
})

export const STOCK_RESEARCH_WORKFLOW_V6: WorkflowDefinition = Object.freeze({
  ...STOCK_RESEARCH_WORKFLOW_V5,
  version: 6,
  maxSteps: 9,
  capabilityCatalogVersion: 1,
  toolAllowlist: Object.freeze([...AGENT_V6_TOOL_KEYS]),
  planSchema: RESEARCH_PLAN_SCHEMA_V3,
  prompt: STOCK_RESEARCH_PROMPT_V4,
  nodes: Object.freeze([
    { key: 'load_context', kind: AiAgentStepKind.WAIT, label: '加载会话上下文' },
    { key: 'select_tools', kind: AiAgentStepKind.PLAN, label: '预选研究工具能力' },
    { key: 'plan', kind: AiAgentStepKind.PLAN, label: '生成受控研究计划' },
    { key: 'authorize_tools', kind: AiAgentStepKind.VALIDATION, label: '校验 Tool 权限与预算' },
    { key: 'execute_tools', kind: AiAgentStepKind.TOOL, label: '执行只读 Tool 计划' },
    { key: 'synthesize', kind: AiAgentStepKind.MODEL, label: '合成研究回答' },
    { key: 'validate_citations', kind: AiAgentStepKind.VALIDATION, label: '校验引用覆盖' },
    { key: 'persist', kind: AiAgentStepKind.FINALIZE, label: '准备最终消息事务' },
    { key: 'complete', kind: AiAgentStepKind.FINALIZE, label: '提交最终消息与终态' },
  ] as const),
})

export const STOCK_RESEARCH_WORKFLOW_CURRENT = STOCK_RESEARCH_WORKFLOW_V6

export const STOCK_RESEARCH_WORKFLOW_DEFINITIONS = Object.freeze([
  ...LEGACY_STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V6,
])
