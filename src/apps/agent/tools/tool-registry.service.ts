import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { UserRole } from '@prisma/client'
import type { NormalizedToolDefinition } from '../model-gateway/model-gateway.port'
import { AGENT_TOOL_KEYS, isAgentToolKey, type AgentToolKey } from '../contracts'
import { AgentToolsConfig, type IAgentToolsConfig } from 'src/config/agent-tools.config'
import type { ToolDefinition, ToolRegistryPin, ToolRegistrySnapshot } from './contracts/tool-definition'
import { cloneAndFreezeJson, stableJson, hashStableJson } from './tool-json'
import { ToolSchemaValidator } from './tool-schema-validator'

export const AGENT_TOOL_DEFINITIONS = Symbol('AGENT_TOOL_DEFINITIONS')

export class ToolRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = ToolRegistryError.name
  }
}

@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly definitions = new Map<string, ToolDefinition>()
  private sealed = false

  constructor(
    private readonly validator: ToolSchemaValidator,
    @Inject(AgentToolsConfig.KEY) private readonly config: IAgentToolsConfig,
    @Inject(AGENT_TOOL_DEFINITIONS) definitions: readonly ToolDefinition[],
  ) {
    for (const definition of definitions) this.register(definition)
  }

  onModuleInit(): void {
    this.sealed = true
  }

  register(definition: ToolDefinition): void {
    if (this.sealed) throw new ToolRegistryError('Tool Registry 已冻结，禁止运行时注册')
    this.assertDefinition(definition)
    const id = toolId(definition.key, definition.version)
    if (this.definitions.has(id)) throw new ToolRegistryError(`Tool 重复注册：${id}`)
    const stored = freezeDefinition(definition)
    this.validator.assertDefinitionSchemas(stored)
    this.definitions.set(id, stored)
  }

  get(key: string, version: number): ToolDefinition {
    if (!isAgentToolKey(key) || !this.config.enabledTools.includes(key)) {
      throw new ToolRegistryError('Tool 未注册或未启用')
    }
    const definition = this.definitions.get(toolId(key, version))
    if (!definition) throw new ToolRegistryError('Tool 未注册或未启用')
    return definition
  }

  freezeSnapshot(pins?: readonly ToolRegistryPin[]): ToolRegistrySnapshot {
    const resolved = pins ? this.resolvePins(pins) : this.latestEnabledPins()
    const entries = Object.freeze(resolved.map((pin) => Object.freeze({ ...pin })))
    const signature = hashStableJson(
      entries.map((pin) => {
        const definition = this.get(pin.key, pin.version)
        return {
          key: definition.key,
          version: definition.version,
          description: definition.description,
          inputSchema: definition.inputSchema,
          outputSchema: definition.outputSchema,
          policy: definition.policy,
        }
      }),
    )
    return Object.freeze({ entries, signature })
  }

  toModelSchemas(snapshot: ToolRegistrySnapshot): NormalizedToolDefinition[] {
    return snapshot.entries.map((pin) => {
      const definition = this.get(pin.key, pin.version)
      return {
        name: definition.key,
        description: definition.description,
        parameters: JSON.parse(stableJson(definition.inputSchema)) as Record<string, unknown>,
      }
    })
  }

  implementationStatus(): Readonly<Record<AgentToolKey, readonly number[]>> {
    return Object.freeze(
      Object.fromEntries(
        AGENT_TOOL_KEYS.map((key) => [
          key,
          Object.freeze(
            [...this.definitions.values()]
              .filter((definition) => definition.key === key)
              .map((definition) => definition.version)
              .sort((left, right) => left - right),
          ),
        ]),
      ) as Record<AgentToolKey, readonly number[]>,
    )
  }

  private resolvePins(pins: readonly ToolRegistryPin[]): ToolRegistryPin[] {
    const unique = new Set<string>()
    const resolved = pins.map((pin) => {
      this.get(pin.key, pin.version)
      const id = toolId(pin.key, pin.version)
      if (unique.has(id)) throw new ToolRegistryError(`Tool snapshot 重复：${id}`)
      unique.add(id)
      return { key: pin.key, version: pin.version }
    })
    return sortPins(resolved)
  }

  private latestEnabledPins(): ToolRegistryPin[] {
    return this.config.enabledTools
      .map((key) => {
        const versions = [...this.definitions.values()]
          .filter((definition) => definition.key === key)
          .map((definition) => definition.version)
        if (!versions.length) return null
        return { key, version: Math.max(...versions) }
      })
      .filter((pin): pin is ToolRegistryPin => pin !== null)
      .sort(comparePins)
  }

  private assertDefinition(definition: ToolDefinition): void {
    if (!isAgentToolKey(definition.key)) throw new ToolRegistryError(`非 canonical Tool key：${definition.key}`)
    if (!Number.isInteger(definition.version) || definition.version < 1) {
      throw new ToolRegistryError('Tool version 必须为正整数')
    }
    if (!definition.description?.trim() || definition.description.length > 1_000) {
      throw new ToolRegistryError('Tool description 必须为 1-1000 字符')
    }
    const policy = definition.policy
    if (!Object.values(UserRole).includes(policy.requiredRole)) throw new ToolRegistryError('Tool requiredRole 非法')
    if (policy.sideEffect !== 'READ') throw new ToolRegistryError('MVP 仅允许注册 READ Tool')
    if (policy.requiresConfirmation) throw new ToolRegistryError('READ Tool 不应要求写操作确认')
    if (!policy.idempotent) throw new ToolRegistryError('MVP READ Tool 必须声明 idempotent')
    requireInteger(policy.timeoutMs, 'timeoutMs', 100, 120_000)
    requireInteger(policy.maxAttempts, 'maxAttempts', 1, 5)
    requireInteger(policy.maxRows, 'maxRows', 1, 10_000)
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(policy.costClass)) throw new ToolRegistryError('Tool costClass 非法')
    if (
      !policy.allowedDataScopes.length ||
      policy.allowedDataScopes.some((scope) => !/^[A-Z][A-Z0-9_]{1,63}$/.test(scope))
    ) {
      throw new ToolRegistryError('Tool allowedDataScopes 必须为非空大写 scope 列表')
    }
    if (typeof definition.execute !== 'function') throw new ToolRegistryError('Tool execute 必填')
  }
}

function toolId(key: string, version: number): string {
  return `${key}@${version}`
}

function sortPins(pins: ToolRegistryPin[]): ToolRegistryPin[] {
  return [...pins].sort(comparePins)
}

function comparePins(left: ToolRegistryPin, right: ToolRegistryPin): number {
  return left.key.localeCompare(right.key) || left.version - right.version
}

function requireInteger(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ToolRegistryError(`Tool ${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
}

function freezeDefinition(definition: ToolDefinition): ToolDefinition {
  const inputSchema = cloneAndFreezeJson(definition.inputSchema)
  const outputSchema = cloneAndFreezeJson(definition.outputSchema)
  const policy = Object.freeze({
    ...definition.policy,
    allowedDataScopes: Object.freeze([...definition.policy.allowedDataScopes]),
  })
  return Object.freeze({ ...definition, description: definition.description.trim(), inputSchema, outputSchema, policy })
}
