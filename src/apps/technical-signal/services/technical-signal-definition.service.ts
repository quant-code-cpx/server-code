import { BadRequestException, Injectable } from '@nestjs/common'
import {
  createTechnicalSignalDefinitionRegistry,
  TECHNICAL_SIGNAL_DEFINITIONS,
  type TechnicalSignalDefinition,
} from '../domain'
import {
  TechnicalSignalDefinitionListRequestDto,
  TechnicalSignalSelectorDto,
} from '../dto/technical-signal-request.dto'
import { TechnicalSignalDefinitionListResponseDto } from '../dto/technical-signal-response.dto'

@Injectable()
export class TechnicalSignalDefinitionService {
  private readonly registry = createTechnicalSignalDefinitionRegistry()

  list(dto: TechnicalSignalDefinitionListRequestDto): TechnicalSignalDefinitionListResponseDto {
    const signalKeys = dto.signalKeys ? uniqueStrings(dto.signalKeys, 'signalKeys') : undefined
    const definitions = TECHNICAL_SIGNAL_DEFINITIONS.filter(
      (definition) => !signalKeys || signalKeys.includes(definition.signalKey),
    )
    if (signalKeys && definitions.length !== signalKeys.length) {
      const known = new Set(definitions.map((definition) => definition.signalKey))
      const unknown = signalKeys.filter((key) => !known.has(key))
      throw new BadRequestException(`TECHNICAL_SIGNAL_UNKNOWN_DEFINITION: ${unknown.join(', ')}`)
    }
    return {
      definitions: definitions.map((definition) => this.toDto(definition)),
    }
  }

  resolveSelectors(selectors?: readonly TechnicalSignalSelectorDto[]): TechnicalSignalDefinition[] {
    if (!selectors) return [...TECHNICAL_SIGNAL_DEFINITIONS]
    if (selectors.length === 0) throw new BadRequestException('TECHNICAL_SIGNAL_REQUEST_INVALID: signals 不能为空')

    const seen = new Set<string>()
    return selectors.map((selector) => {
      const candidates = TECHNICAL_SIGNAL_DEFINITIONS.filter(
        (definition) => definition.signalKey === selector.signalKey,
      )
      const definition = selector.semanticsVersion
        ? this.registry.get(`${selector.signalKey}|${selector.semanticsVersion}`)
        : candidates[0]
      if (!definition) {
        throw new BadRequestException(
          `TECHNICAL_SIGNAL_UNKNOWN_DEFINITION: ${selector.signalKey}${selector.semanticsVersion ? `@${selector.semanticsVersion}` : ''}`,
        )
      }
      const key = `${definition.signalKey}|${definition.semanticsVersion}`
      if (seen.has(key)) throw new BadRequestException(`TECHNICAL_SIGNAL_REQUEST_INVALID: signals 存在重复定义 ${key}`)
      seen.add(key)
      return definition
    })
  }

  resolveOne(signalKey: string, semanticsVersion?: string): TechnicalSignalDefinition {
    return this.resolveSelectors([{ signalKey, semanticsVersion }])[0]
  }

  private toDto(definition: TechnicalSignalDefinition) {
    return {
      signalKey: definition.signalKey,
      semanticsVersion: definition.semanticsVersion,
      definitionHash: definition.definitionHash,
      displayName: definition.displayName,
      direction: definition.direction,
      source: definition.source,
      description: definition.description,
      parameters: { ...definition.parameters },
      stable: true,
      deprecatedAt: null,
    }
  }
}

function uniqueStrings(values: readonly string[], field: string): string[] {
  const unique = new Set(values)
  if (unique.size !== values.length) {
    throw new BadRequestException(`TECHNICAL_SIGNAL_REQUEST_INVALID: ${field} 存在重复值`)
  }
  return [...unique]
}
