import type { ModelChunk, ModelPurpose, ModelStructuredStreamEvent } from '../model-gateway/model-gateway.port'
import type { ModelTokenCountSource } from '../model-gateway/model-gateway.port'
import type { WorkflowBudgetLimits } from './workflow.types'

export interface ModelPublicTraceContext {
  messageCount: number
  estimatedInputTokens: number
  maxOutputTokens: number
  contextWindow: number
  inputTokenCountSource: ModelTokenCountSource
  inputTokenCountExact: boolean
  inputTokenSafetyMarginTokens: number
  runInputReservationTokens: number
  runMaxCumulativeInputTokens: number | null
  runInputTokensUsedBeforeCall: number
  runInputGuardrailSource: WorkflowBudgetLimits['inputTokenGuardrailSource']
}

export type PublicModelStreamEvent =
  | {
      eventType: 'model.trace'
      payload:
        | {
            modelCallId: string
            attempt: number
            phase: 'REQUEST_DISPATCHED'
            messageCount: number
            estimatedInputTokens: number
            maxOutputTokens: number
            contextWindow: number
            inputTokenCountSource: ModelTokenCountSource
            inputTokenCountExact: boolean
            inputTokenSafetyMarginTokens: number
            runInputReservationTokens: number
            runMaxCumulativeInputTokens: number | null
            runInputTokensUsedBeforeCall: number
            runInputGuardrailSource: WorkflowBudgetLimits['inputTokenGuardrailSource']
          }
        | {
            modelCallId: string
            attempt: number
            phase: 'FIRST_PROVIDER_CHUNK'
            chunkType: 'REASONING' | 'OUTPUT' | 'TOOL_CALL' | 'USAGE' | 'COMPLETED'
          }
        | { modelCallId: string; attempt: number; phase: 'STRUCTURED_REPAIR' }
        | { modelCallId: string; attempt: number; phase: 'PROVIDER_COMPLETED'; finishReason: string | null }
    }
  | {
      eventType: 'model.activity'
      payload: { modelCallId: string; phase: 'REASONING'; processedCharacters: number }
    }
  | {
      eventType: 'model.preview.reset'
      payload: { modelCallId: string; attempt: number }
    }
  | {
      eventType: 'model.preview.delta'
      payload: { modelCallId: string; attempt: number; delta: string }
    }

type PublicEventSink = (event: PublicModelStreamEvent) => Promise<void>

const ACTIVITY_REPORT_INTERVAL = 2_048
const MAX_ACTIVITY_EVENTS = 64
const PREVIEW_FLUSH_CHARS = 256
const PREVIEW_EVENT_MAX_CHARS = 2_048
const PREVIEW_MAX_CHARS = 8_000
const MAX_JSON_PREFIX_CHARS = 64_000

export class ModelStreamPublicProjector {
  private extractor = new JsonStringFieldExtractor('markdown', PREVIEW_MAX_CHARS)
  private attempt = 1
  private reasoningCharacters = 0
  private lastReportedReasoningCharacters = 0
  private activityEvents = 0
  private previewBuffer = ''
  private receivedFirstChunk = false

  constructor(
    private readonly purpose: ModelPurpose,
    private readonly modelCallId: string,
    private readonly traceContext: ModelPublicTraceContext,
    private readonly sink: PublicEventSink,
  ) {}

  async observe(event: ModelStructuredStreamEvent): Promise<void> {
    if (event.type === 'ATTEMPT_STARTED') {
      this.attempt = event.repairAttempt + 1
      this.extractor = new JsonStringFieldExtractor('markdown', PREVIEW_MAX_CHARS)
      this.previewBuffer = ''
      this.receivedFirstChunk = false
      await this.recordAttemptStarted(event.repairAttempt)
      if (this.purpose === 'SYNTHESIZE') {
        await this.sink({
          eventType: 'model.preview.reset',
          payload: { modelCallId: this.modelCallId, attempt: this.attempt },
        })
      }
      return
    }

    await this.recordFirstProviderChunk(event.chunk)
    if (event.chunk.type === 'REASONING_ACTIVITY') {
      await this.recordReasoningActivity(event.chunk.characters)
      return
    }

    if (event.chunk.type === 'COMPLETED') {
      if (this.purpose === 'SYNTHESIZE') await this.flushPreview()
      await this.sink({
        eventType: 'model.trace',
        payload: {
          modelCallId: this.modelCallId,
          attempt: this.attempt,
          phase: 'PROVIDER_COMPLETED',
          finishReason: event.chunk.finishReason,
        },
      })
      return
    }

    if (this.purpose !== 'SYNTHESIZE') return
    if (event.chunk.type === 'OUTPUT_TEXT_DELTA') {
      this.previewBuffer += this.extractor.push(event.chunk.text)
      if (this.previewBuffer.length >= PREVIEW_FLUSH_CHARS || this.previewBuffer.includes('\n')) {
        await this.flushPreview()
      }
      return
    }
  }

  private async recordAttemptStarted(repairAttempt: number): Promise<void> {
    if (repairAttempt > 0) {
      await this.sink({
        eventType: 'model.trace',
        payload: { modelCallId: this.modelCallId, attempt: this.attempt, phase: 'STRUCTURED_REPAIR' },
      })
      return
    }
    await this.sink({
      eventType: 'model.trace',
      payload: {
        modelCallId: this.modelCallId,
        attempt: this.attempt,
        phase: 'REQUEST_DISPATCHED',
        ...this.traceContext,
      },
    })
  }

  private async recordFirstProviderChunk(chunk: ModelChunk): Promise<void> {
    if (this.receivedFirstChunk) return
    this.receivedFirstChunk = true
    await this.sink({
      eventType: 'model.trace',
      payload: {
        modelCallId: this.modelCallId,
        attempt: this.attempt,
        phase: 'FIRST_PROVIDER_CHUNK',
        chunkType: publicChunkType(chunk),
      },
    })
  }

  private async recordReasoningActivity(characters: number): Promise<void> {
    if (!Number.isSafeInteger(characters) || characters < 1) return
    this.reasoningCharacters = Math.min(Number.MAX_SAFE_INTEGER, this.reasoningCharacters + characters)
    const shouldReport =
      this.activityEvents < MAX_ACTIVITY_EVENTS &&
      (this.lastReportedReasoningCharacters === 0 ||
        this.reasoningCharacters - this.lastReportedReasoningCharacters >= ACTIVITY_REPORT_INTERVAL)
    if (!shouldReport) return
    this.activityEvents += 1
    this.lastReportedReasoningCharacters = this.reasoningCharacters
    await this.sink({
      eventType: 'model.activity',
      payload: {
        modelCallId: this.modelCallId,
        phase: 'REASONING',
        processedCharacters: this.reasoningCharacters,
      },
    })
  }

  private async flushPreview(): Promise<void> {
    while (this.previewBuffer.length > 0) {
      const delta = this.previewBuffer.slice(0, PREVIEW_EVENT_MAX_CHARS)
      this.previewBuffer = this.previewBuffer.slice(delta.length)
      await this.sink({
        eventType: 'model.preview.delta',
        payload: { modelCallId: this.modelCallId, attempt: this.attempt, delta },
      })
    }
  }
}

function publicChunkType(chunk: ModelChunk): 'REASONING' | 'OUTPUT' | 'TOOL_CALL' | 'USAGE' | 'COMPLETED' {
  if (chunk.type === 'REASONING_ACTIVITY') return 'REASONING'
  if (chunk.type === 'OUTPUT_TEXT_DELTA') return 'OUTPUT'
  if (chunk.type === 'TOOL_CALL_DELTA' || chunk.type === 'TOOL_CALL_COMPLETED') return 'TOOL_CALL'
  if (chunk.type === 'USAGE') return 'USAGE'
  return 'COMPLETED'
}

export class JsonStringFieldExtractor {
  private source = ''
  private cursor: number | null = null
  private emittedCharacters = 0
  private done = false

  constructor(
    private readonly fieldName: string,
    private readonly maxCharacters: number,
  ) {}

  push(fragment: string): string {
    if (this.done || !fragment) return ''
    this.source += fragment
    if (this.cursor == null) {
      const start = findStringFieldValueStart(this.source, this.fieldName)
      if (start === 'INVALID' || (start == null && this.source.length > MAX_JSON_PREFIX_CHARS)) {
        this.done = true
        return ''
      }
      if (start == null) return ''
      this.cursor = start
    }

    let output = ''
    while (!this.done && this.cursor < this.source.length && this.emittedCharacters < this.maxCharacters) {
      const decoded = decodeNextJsonStringCharacter(this.source, this.cursor)
      if (decoded.status === 'INCOMPLETE') break
      if (decoded.status === 'DONE' || decoded.status === 'INVALID') {
        this.done = true
        break
      }
      if (decoded.status !== 'VALUE') break
      this.cursor = decoded.next
      const remaining = this.maxCharacters - this.emittedCharacters
      const value = decoded.value.slice(0, remaining)
      output += value
      this.emittedCharacters += value.length
      if (this.emittedCharacters >= this.maxCharacters) this.done = true
    }
    return output
  }
}

type FieldStart = number | 'INVALID' | null

function findStringFieldValueStart(source: string, fieldName: string): FieldStart {
  const stack: string[] = []
  let index = 0
  let previousToken = ''
  while (index < source.length) {
    const character = source[index]
    if (/\s/.test(character)) {
      index += 1
      continue
    }
    if (character === '{' || character === '[') {
      stack.push(character)
      previousToken = character
      index += 1
      continue
    }
    if (character === '}' || character === ']') {
      stack.pop()
      previousToken = character
      index += 1
      continue
    }
    if (character === '"') {
      const end = findJsonStringEnd(source, index + 1)
      if (end == null) return null
      if (stack.length === 1 && stack[0] === '{' && (previousToken === '{' || previousToken === ',')) {
        let key: unknown
        try {
          key = JSON.parse(source.slice(index, end + 1))
        } catch {
          return 'INVALID'
        }
        let valueStart = end + 1
        while (valueStart < source.length && /\s/.test(source[valueStart])) valueStart += 1
        if (valueStart >= source.length) return null
        if (source[valueStart] !== ':') return 'INVALID'
        valueStart += 1
        while (valueStart < source.length && /\s/.test(source[valueStart])) valueStart += 1
        if (valueStart >= source.length) return null
        if (key === fieldName) return source[valueStart] === '"' ? valueStart + 1 : 'INVALID'
      }
      previousToken = 'STRING'
      index = end + 1
      continue
    }
    previousToken = character
    index += 1
  }
  return null
}

function findJsonStringEnd(source: string, start: number): number | null {
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') escaped = true
    else if (character === '"') return index
  }
  return null
}

type DecodedCharacter = { status: 'VALUE'; value: string; next: number } | { status: 'INCOMPLETE' | 'DONE' | 'INVALID' }

function decodeNextJsonStringCharacter(source: string, cursor: number): DecodedCharacter {
  const character = source[cursor]
  if (character === '"') return { status: 'DONE' }
  if (character.charCodeAt(0) < 0x20) return { status: 'INVALID' }
  if (character !== '\\') {
    if (isHighSurrogate(character)) {
      if (cursor + 1 >= source.length) return { status: 'INCOMPLETE' }
      const low = source[cursor + 1]
      if (!isLowSurrogate(low)) return { status: 'VALUE', value: '\uFFFD', next: cursor + 1 }
      return { status: 'VALUE', value: character + low, next: cursor + 2 }
    }
    if (isLowSurrogate(character)) return { status: 'VALUE', value: '\uFFFD', next: cursor + 1 }
    return { status: 'VALUE', value: character, next: cursor + 1 }
  }

  if (cursor + 1 >= source.length) return { status: 'INCOMPLETE' }
  const escape = source[cursor + 1]
  const simpleEscapes: Record<string, string> = {
    '"': '"',
    '\\': '\\',
    '/': '/',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
  }
  if (escape in simpleEscapes) {
    return { status: 'VALUE', value: simpleEscapes[escape], next: cursor + 2 }
  }
  if (escape !== 'u') return { status: 'INVALID' }
  const first = readUnicodeEscape(source, cursor)
  if (first.status !== 'VALUE') return first
  if (first.codeUnit >= 0xd800 && first.codeUnit <= 0xdbff) {
    const second = readUnicodeEscape(source, first.next)
    if (second.status === 'INCOMPLETE') return second
    if (second.status !== 'VALUE' || second.codeUnit < 0xdc00 || second.codeUnit > 0xdfff) {
      return { status: 'VALUE', value: '\uFFFD', next: first.next }
    }
    return {
      status: 'VALUE',
      value: String.fromCodePoint(0x10000 + ((first.codeUnit - 0xd800) << 10) + (second.codeUnit - 0xdc00)),
      next: second.next,
    }
  }
  if (first.codeUnit >= 0xdc00 && first.codeUnit <= 0xdfff) {
    return { status: 'VALUE', value: '\uFFFD', next: first.next }
  }
  return { status: 'VALUE', value: String.fromCharCode(first.codeUnit), next: first.next }
}

type UnicodeEscape = { status: 'VALUE'; codeUnit: number; next: number } | { status: 'INCOMPLETE' | 'INVALID' }

function readUnicodeEscape(source: string, cursor: number): UnicodeEscape {
  if (cursor + 2 > source.length) return { status: 'INCOMPLETE' }
  if (source[cursor] !== '\\' || source[cursor + 1] !== 'u') return { status: 'INVALID' }
  if (cursor + 6 > source.length) return { status: 'INCOMPLETE' }
  const hex = source.slice(cursor + 2, cursor + 6)
  if (!/^[0-9A-Fa-f]{4}$/.test(hex)) return { status: 'INVALID' }
  return { status: 'VALUE', codeUnit: Number.parseInt(hex, 16), next: cursor + 6 }
}

function isHighSurrogate(character: string): boolean {
  const code = character.charCodeAt(0)
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(character: string): boolean {
  const code = character.charCodeAt(0)
  return code >= 0xdc00 && code <= 0xdfff
}
