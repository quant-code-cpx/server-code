import { Injectable } from '@nestjs/common'
import { ToolRegistryService } from '../../tools/tool-registry.service'
import { modelMessage, WorkflowModelService } from '../workflow-model.service'
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
  ) {}

  async execute({ run, workflow, state, limits, stepId, signal }: WorkflowNodeExecutionContext) {
    if (!state.context) throw new WorkflowValidationError('plan 节点缺少已加载上下文')
    const enabledSnapshot = this.tools.freezeSnapshot()
    const allowedEntries = enabledSnapshot.entries.filter((pin) => workflow.toolAllowlist.includes(pin.key))
    const toolSchemas = this.tools.toModelSchemas({ entries: allowedEntries, signature: enabledSnapshot.signature })
    const request = await this.models.generateStructured<ResearchPlan>({
      run,
      stepId,
      purpose: 'PLAN',
      messages: [
        modelMessage('system', run.promptVersion.template),
        modelMessage(
          'user',
          JSON.stringify({
            task: state.context.userText,
            recentMessages: state.context.recentMessages,
            pageContext: state.context.pageContext,
            allowedCapabilities: state.context.allowedCapabilities,
            availableTools: toolSchemas,
            instruction: 'Produce a short visible plan. Do not include hidden reasoning.',
          }),
        ),
      ],
      responseSchema: RESEARCH_PLAN_SCHEMA,
      maxOutputTokens: 2_000,
      usage: state.budget,
      limits,
      signal,
    })
    return { ...state, plan: request.data, budget: request.usage, modelName: request.modelName }
  }
}
