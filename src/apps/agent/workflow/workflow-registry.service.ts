import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import type { AiPromptVersion, AiWorkflowVersion } from '@prisma/client'
import { hashStableJson, cloneAndFreezeJson } from '../tools/tool-json'
import { WorkflowVersionError } from './workflow.errors'
import { STOCK_RESEARCH_NODE_KEYS, type FrozenWorkflowDefinition, type WorkflowDefinition } from './workflow.types'

export const AGENT_WORKFLOW_DEFINITIONS = Symbol('AGENT_WORKFLOW_DEFINITIONS')

@Injectable()
export class WorkflowRegistryService implements OnModuleInit {
  private readonly definitions = new Map<string, FrozenWorkflowDefinition>()
  private sealed = false

  constructor(@Inject(AGENT_WORKFLOW_DEFINITIONS) definitions: readonly WorkflowDefinition[]) {
    for (const definition of definitions) this.register(definition)
  }

  onModuleInit(): void {
    this.sealed = true
  }

  register(definition: WorkflowDefinition): void {
    if (this.sealed) throw new WorkflowVersionError('Workflow Registry 已冻结')
    assertWorkflowDefinition(definition)
    const id = workflowId(definition.key, definition.version)
    if (this.definitions.has(id)) throw new WorkflowVersionError(`Workflow 重复注册：${id}`)
    const cloned = cloneAndFreezeJson(definition)
    const frozen = Object.freeze({
      ...cloned,
      contentHash: hashStableJson(workflowVersionPayload(cloned)),
      promptContentHash: hashStableJson(promptVersionPayload(cloned)),
    }) as FrozenWorkflowDefinition
    this.definitions.set(id, frozen)
  }

  resolve(key: string, version: number): FrozenWorkflowDefinition {
    const definition = this.definitions.get(workflowId(key.trim(), version))
    if (!definition) throw new WorkflowVersionError('工作流版本不存在')
    return definition
  }

  resolvePublished(workflowVersion: AiWorkflowVersion, promptVersion: AiPromptVersion): FrozenWorkflowDefinition {
    if (workflowVersion.status !== 'PUBLISHED') throw new WorkflowVersionError('工作流版本未发布')
    const definition = this.resolve(workflowVersion.workflowKey, workflowVersion.version)
    if (workflowVersion.contentHash !== definition.contentHash) {
      throw new WorkflowVersionError('工作流版本 hash 与服务器定义不一致')
    }
    if (promptVersion.status !== 'PUBLISHED') throw new WorkflowVersionError('Prompt 版本未发布', 6025)
    if (
      promptVersion.promptKey !== definition.prompt.key ||
      promptVersion.version !== definition.prompt.version ||
      promptVersion.contentHash !== definition.promptContentHash
    ) {
      throw new WorkflowVersionError('Prompt 版本与工作流冻结定义不一致', 6025)
    }
    return definition
  }

  snapshot(key: string, version: number) {
    const definition = this.resolve(key, version)
    return Object.freeze({
      workflowKey: definition.key,
      version: definition.version,
      definition: workflowDefinitionPayload(definition),
      toolAllowlist: [...definition.toolAllowlist],
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      contentHash: definition.contentHash,
      prompt: Object.freeze({
        promptKey: definition.prompt.key,
        version: definition.prompt.version,
        template: definition.prompt.template,
        inputSchema: definition.prompt.inputSchema,
        outputSchema: definition.prompt.outputSchema,
        contentHash: definition.promptContentHash,
      }),
    })
  }
}

export function workflowDefinitionPayload(definition: WorkflowDefinition): Record<string, unknown> {
  return {
    key: definition.key,
    version: definition.version,
    inputSchemaVersion: definition.inputSchemaVersion,
    maxSteps: definition.maxSteps,
    maxParallelTools: definition.maxParallelTools,
    prompt: { key: definition.prompt.key, version: definition.prompt.version },
    nodes: definition.nodes.map((node) => ({ key: node.key, kind: node.kind, label: node.label })),
  }
}

function workflowVersionPayload(definition: WorkflowDefinition): Record<string, unknown> {
  return {
    definition: workflowDefinitionPayload(definition),
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    toolAllowlist: [...definition.toolAllowlist].sort(),
  }
}

function promptVersionPayload(definition: WorkflowDefinition): Record<string, unknown> {
  return {
    inputSchema: definition.prompt.inputSchema,
    outputSchema: definition.prompt.outputSchema,
    template: definition.prompt.template,
  }
}

function assertWorkflowDefinition(definition: WorkflowDefinition): void {
  if (!/^[a-z][a-z0-9_]{1,127}$/.test(definition.key)) throw new WorkflowVersionError('Workflow key 非法')
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new WorkflowVersionError('Workflow version 必须为正整数')
  }
  if (definition.maxSteps !== definition.nodes.length || definition.maxSteps < STOCK_RESEARCH_NODE_KEYS.length) {
    throw new WorkflowVersionError('Workflow maxSteps 必须覆盖固定节点且与节点数一致')
  }
  const keys = definition.nodes.map((node) => node.key)
  if (keys.join(',') !== STOCK_RESEARCH_NODE_KEYS.join(',')) {
    throw new WorkflowVersionError('Workflow 固定节点顺序非法')
  }
  if (!Number.isInteger(definition.maxParallelTools) || definition.maxParallelTools < 1) {
    throw new WorkflowVersionError('Workflow maxParallelTools 必须为正整数')
  }
  if (new Set(definition.toolAllowlist).size !== definition.toolAllowlist.length) {
    throw new WorkflowVersionError('Workflow Tool allowlist 包含重复项')
  }
}

function workflowId(key: string, version: number): string {
  return `${key}@${version}`
}
