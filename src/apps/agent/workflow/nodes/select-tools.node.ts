import { Injectable } from '@nestjs/common'
import { ContextBuilderService } from '../../memory/context-builder.service'
import {
  TOOL_CAPABILITY_PACK_KEYS,
  ToolCapabilityCatalogService,
  type ToolCapabilityDescriptor,
  type ToolCapabilityPackKey,
} from '../../tools/tool-capability-catalog.service'
import type { AgentToolKey } from '../../contracts'
import { parseMarketScreeningRequest } from '../market-screening-recovery'
import { WorkflowModelService } from '../workflow-model.service'
import { WorkflowCancelledError, WorkflowTimeoutError, WorkflowValidationError } from '../workflow.errors'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

interface RawToolSelection {
  packs: ToolCapabilityPackKey[]
  toolKeys: AgentToolKey[]
  reason: string
}

@Injectable()
export class SelectToolsNode implements WorkflowNodeHandler {
  readonly key = 'select_tools' as const

  constructor(
    private readonly models: WorkflowModelService,
    private readonly catalogs: ToolCapabilityCatalogService,
    private readonly contexts: ContextBuilderService,
  ) {}

  async execute({ run, workflow, state, limits, stepId, workerId, signal }: WorkflowNodeExecutionContext) {
    if (!state.context) throw new WorkflowValidationError('select_tools 节点缺少已加载上下文')
    const modelProfile = state.modelProfile ?? this.models.resolveModelProfile(run)
    const catalog = this.catalogs.snapshot(workflow)
    const marketScreening = parseMarketScreeningRequest(state.context.userText)
    if (marketScreening) {
      if (!catalog.descriptors.some((item) => item.key === 'screen_stocks')) {
        throw new WorkflowValidationError('全市场板块排行需要 screen_stocks，但当前未启用')
      }
      return {
        ...state,
        modelProfile,
        toolSelection: audit(
          catalog,
          {
            packs: ['STOCK_TECHNICAL'],
            toolKeys: ['screen_stocks'],
            reason: `确定性路由：按${marketScreening.markets.join('、')}全样本买入信号排行`,
          },
          false,
          null,
        ),
      }
    }
    const fallback = buildFallback(catalog.descriptors)
    if (!catalog.descriptors.length) {
      return {
        ...state,
        modelProfile,
        toolSelection: audit(catalog, fallback, true, null),
        warnings: [...new Set([...state.warnings, 'Tool 能力目录没有已启用项，已使用空的安全回退'])],
      }
    }
    const prepared = this.contexts.prepareModelCall({
      context: state.context,
      budget: this.models.resolveInputTokenBudget(modelProfile, state.budget, limits),
      purpose: 'PLAN',
      instruction:
        'Select only the smallest relevant tool set for the latest user request. Return visible routing rationale, never hidden reasoning. Choose 1-3 packs and 1-18 tool keys from the supplied frozen catalog. Do not select screen_stocks for an exact single-stock indicator or signal question. Select get_data_availability only for coverage/freshness questions or likely missing-data explanation. Route INDEX to get_index_market_data, FUND to get_fund_research, and never route either to stock-price tools.',
      stageData: {
        capabilityCatalog: {
          version: catalog.version,
          hash: catalog.hash,
          tools: catalog.descriptors,
        },
      },
    })
    try {
      const request = await this.models.generateStructured<RawToolSelection>({
        run,
        stepId,
        purpose: 'PLAN',
        messages: prepared.messages,
        contextManifest: prepared.manifest,
        responseSchema: selectionSchema(catalog.descriptors),
        maxOutputTokens: Math.min(1_000, this.models.resolveMaxOutputTokens(modelProfile, state.budget, limits)),
        usage: state.budget,
        limits,
        workerId,
        signal,
        modelProfile,
      })
      const selected = normalizeSelection(request.data, catalog.descriptors)
      return {
        ...state,
        modelProfile,
        context: prepared.context,
        toolSelection: audit(catalog, selected, false, request.modelName),
        budget: request.usage,
        modelName: request.modelName,
        warnings: [...new Set([...state.warnings, ...prepared.warnings])],
      }
    } catch (error) {
      if (signal?.aborted || error instanceof WorkflowCancelledError || error instanceof WorkflowTimeoutError) {
        throw error
      }
      return {
        ...state,
        modelProfile,
        context: prepared.context,
        toolSelection: audit(catalog, fallback, true, null),
        warnings: [...new Set([...state.warnings, ...prepared.warnings, 'Tool 能力预选失败，已回退核心研究工具'])],
      }
    }
  }
}

function normalizeSelection(raw: RawToolSelection, descriptors: readonly ToolCapabilityDescriptor[]): RawToolSelection {
  const descriptorByKey = new Map(descriptors.map((item) => [item.key, item]))
  const selectedPacks = [...new Set(raw.packs)]
  const selectedKeys = [...new Set(raw.toolKeys)].filter((key) => {
    const descriptor = descriptorByKey.get(key)
    return descriptor && selectedPacks.includes(descriptor.pack)
  })
  if (selectedPacks.length < 1 || selectedPacks.length > 3 || selectedKeys.length < 1 || selectedKeys.length > 18) {
    throw new WorkflowValidationError('Tool 能力预选结果越界')
  }
  const needsResolver = selectedKeys.some((key) => descriptorByKey.get(key)?.requiresSecurityTypes.length)
  if (needsResolver && descriptorByKey.has('resolve_security') && !selectedKeys.includes('resolve_security')) {
    if (!selectedPacks.includes('CORE_RESEARCH')) {
      if (selectedPacks.length === 3) selectedPacks.pop()
      selectedPacks.unshift('CORE_RESEARCH')
    }
    if (selectedKeys.length === 18) selectedKeys.pop()
    selectedKeys.unshift('resolve_security')
  }
  return { packs: selectedPacks, toolKeys: selectedKeys, reason: raw.reason.trim().slice(0, 500) }
}

function buildFallback(descriptors: readonly ToolCapabilityDescriptor[]): RawToolSelection {
  const coreKeys = descriptors
    .filter((item) => item.pack === 'CORE_RESEARCH')
    .map((item) => item.key)
  return {
    packs: ['CORE_RESEARCH'],
    toolKeys: coreKeys.slice(0, 18),
    reason: '能力预选失败，使用最小核心研究工具集',
  }
}

function audit(
  catalog: { version: 1 | 2 | 3 | 4; hash: string },
  selection: RawToolSelection,
  fallback: boolean,
  modelName: string | null,
) {
  return {
    catalogVersion: catalog.version,
    catalogHash: catalog.hash,
    selectionPromptVersion: catalog.version,
    packs: selection.packs,
    toolKeys: selection.toolKeys,
    reason: selection.reason,
    fallback,
    modelName,
  }
}

function selectionSchema(descriptors: readonly ToolCapabilityDescriptor[]): Record<string, unknown> {
  const packs = [...new Set(descriptors.map((item) => item.pack))].filter((pack) =>
    TOOL_CAPABILITY_PACK_KEYS.includes(pack),
  )
  return {
    type: 'object',
    additionalProperties: false,
    required: ['packs', 'toolKeys', 'reason'],
    properties: {
      packs: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { enum: packs } },
      toolKeys: {
        type: 'array',
        minItems: 1,
        maxItems: 18,
        uniqueItems: true,
        items: { enum: descriptors.map((item) => item.key) },
      },
      reason: { type: 'string', minLength: 1, maxLength: 500 },
    },
  }
}
