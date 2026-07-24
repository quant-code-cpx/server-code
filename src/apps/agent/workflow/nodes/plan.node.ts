import { Injectable } from '@nestjs/common'
import { ContextBuilderService } from '../../memory/context-builder.service'
import { ToolRegistryService } from '../../tools/tool-registry.service'
import { WorkflowModelService } from '../workflow-model.service'
import type { ResearchPlan } from '../workflow.types'
import { RESEARCH_PLAN_SCHEMA } from '../workflows/stock-research.v1'
import { WorkflowValidationError } from '../workflow.errors'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

@Injectable()
export class PlanNode implements WorkflowNodeHandler {
  readonly key = 'plan' as const

  constructor(
    private readonly models: WorkflowModelService,
    private readonly tools: ToolRegistryService,
    private readonly contexts: ContextBuilderService,
  ) {}

  async execute({ run, workflow, state, limits, stepId, workerId, signal }: WorkflowNodeExecutionContext) {
    if (!state.context) throw new WorkflowValidationError('plan 节点缺少已加载上下文')
    const enabledSnapshot = this.tools.freezeSnapshot()
    const allowedEntries = enabledSnapshot.entries.filter((pin) => workflow.toolAllowlist.includes(pin.key))
    const toolSchemas = this.tools.toModelSchemas({ entries: allowedEntries, signature: enabledSnapshot.signature })
    const maxOutputTokens = 2_000
    const prepared = this.contexts.prepareModelCall({
      context: state.context,
      budget: this.models.resolveInputTokenBudget(run, state.budget, limits, maxOutputTokens),
      purpose: 'PLAN',
      instruction:
        'Produce a short visible plan for the latest user message. Do not include hidden reasoning. For a dependent Tool input, bind a prior result with {"$toolResult":{"callId":"search","path":["results",0,"urlToken"]}}; callId must be listed in the current call dependsOn. Search snippets select candidates only and never support factual claims.',
      stageData: { availableTools: toolSchemas },
    })
    const request = await this.models.generateStructured<ResearchPlan>({
      run,
      stepId,
      purpose: 'PLAN',
      messages: prepared.messages,
      contextManifest: prepared.manifest,
      responseSchema: RESEARCH_PLAN_SCHEMA,
      maxOutputTokens,
      usage: state.budget,
      limits,
      workerId,
      signal,
    })
    return {
      ...state,
      context: prepared.context,
      plan: request.data,
      budget: request.usage,
      modelName: request.modelName,
      warnings: [...new Set([...state.warnings, ...prepared.warnings])],
    }
  }
}
