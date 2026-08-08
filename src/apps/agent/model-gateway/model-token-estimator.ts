import type { ModelRequest, ModelTokenCountEstimate } from './model-gateway.port'

const ESTIMATE_SAFETY_RATIO = 0.12
const MINIMUM_SAFETY_TOKENS = 32

/**
 * Provider 无 count-tokens 能力时的保守回退。
 * 估算完整规范化请求，包含消息、工具、JSON Schema、推理参数与结构开销；
 * 不再使用字符数 / 4，也不把该估算宣称为精确 tokenizer 结果。
 */
export function estimateModelRequestTokens(request: ModelRequest): ModelTokenCountEstimate {
  const serialized = JSON.stringify({
    messages: request.messages,
    tools: request.tools ?? [],
    responseSchema: request.responseSchema ?? null,
    reasoning: request.reasoning ?? request.reasoningEffort ?? null,
    dataClass: request.dataClass ?? 'PUBLIC',
  })
  const rawInputTokens = estimateTextTokens(serialized) + 12
  const safetyMarginTokens = Math.max(MINIMUM_SAFETY_TOKENS, Math.ceil(rawInputTokens * ESTIMATE_SAFETY_RATIO))
  return {
    inputTokens: rawInputTokens + safetyMarginTokens,
    rawInputTokens,
    safetyMarginTokens,
    source: 'LOCAL_CONSERVATIVE_V1',
    exact: false,
  }
}

/** 对中英文、JSON 标点、emoji 分别计权的保守文本估算。 */
export function estimateTextTokens(text: string): number {
  let tokens = 0
  let asciiWordLength = 0
  const flushAsciiWord = () => {
    if (asciiWordLength > 0) tokens += Math.ceil(asciiWordLength / 3)
    asciiWordLength = 0
  }

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 0x7f && /[A-Za-z0-9_]/.test(character)) {
      asciiWordLength += 1
      continue
    }
    flushAsciiWord()
    if (/\s/.test(character)) continue
    if (code <= 0x7f) tokens += 1
    else if (isCjk(code)) tokens += 1
    else tokens += code > 0xffff ? 2 : 1
  }
  flushAsciiWord()
  return Math.max(1, tokens)
}

function isCjk(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0x20000 && code <= 0x323af)
  )
}
