import {
  JsonStringFieldExtractor,
  ModelStreamPublicProjector,
  type PublicModelStreamEvent,
} from '../model-stream-public-projector'

const traceContext = {
  messageCount: 3,
  estimatedInputTokens: 1_024,
  maxOutputTokens: 2_048,
  contextWindow: 32_768,
  inputTokenCountSource: 'LOCAL_CONSERVATIVE_V1' as const,
  inputTokenCountExact: false,
  inputTokenSafetyMarginTokens: 128,
  runInputReservationTokens: 4_096,
  runMaxCumulativeInputTokens: null,
  runInputTokensUsedBeforeCall: 0,
  runInputGuardrailSource: 'DISABLED_BY_DEFAULT' as const,
}

describe('ModelStreamPublicProjector', () => {
  it('只公开推理活动计数，不接收或持久化原始思维链文本', async () => {
    const emitted: PublicModelStreamEvent[] = []
    const projector = new ModelStreamPublicProjector('PLAN', 'model_call_1', traceContext, async (event) => {
      emitted.push(event)
    })

    await projector.observe({ type: 'ATTEMPT_STARTED', repairAttempt: 0 })
    await projector.observe({
      type: 'CHUNK',
      repairAttempt: 0,
      chunk: { type: 'REASONING_ACTIVITY', characters: 37 },
    })
    await projector.observe({
      type: 'CHUNK',
      repairAttempt: 0,
      chunk: { type: 'REASONING_ACTIVITY', characters: 100 },
    })
    await projector.observe({
      type: 'CHUNK',
      repairAttempt: 0,
      chunk: { type: 'REASONING_ACTIVITY', characters: 2_048 },
    })

    expect(emitted).toEqual([
      {
        eventType: 'model.trace',
        payload: {
          modelCallId: 'model_call_1',
          attempt: 1,
          phase: 'REQUEST_DISPATCHED',
          ...traceContext,
        },
      },
      {
        eventType: 'model.trace',
        payload: {
          modelCallId: 'model_call_1',
          attempt: 1,
          phase: 'FIRST_PROVIDER_CHUNK',
          chunkType: 'REASONING',
        },
      },
      {
        eventType: 'model.activity',
        payload: { modelCallId: 'model_call_1', phase: 'REASONING', processedCharacters: 37 },
      },
      {
        eventType: 'model.activity',
        payload: { modelCallId: 'model_call_1', phase: 'REASONING', processedCharacters: 2_185 },
      },
    ])
  })

  it('流式提取 markdown 草稿，并在结构化输出修复时先重置旧草稿', async () => {
    const emitted: PublicModelStreamEvent[] = []
    const projector = new ModelStreamPublicProjector('SYNTHESIZE', 'model_call_1', traceContext, async (event) => {
      emitted.push(event)
    })

    await projector.observe({ type: 'ATTEMPT_STARTED', repairAttempt: 0 })
    await projector.observe({
      type: 'CHUNK',
      repairAttempt: 0,
      chunk: { type: 'OUTPUT_TEXT_DELTA', text: '{"markdown":"第一版\\n结论' },
    })
    await projector.observe({
      type: 'CHUNK',
      repairAttempt: 0,
      chunk: { type: 'COMPLETED', finishReason: 'stop' },
    })
    await projector.observe({ type: 'ATTEMPT_STARTED', repairAttempt: 1 })
    await projector.observe({
      type: 'CHUNK',
      repairAttempt: 1,
      chunk: { type: 'OUTPUT_TEXT_DELTA', text: '{"markdown":"修复版","claims":[]}' },
    })
    await projector.observe({
      type: 'CHUNK',
      repairAttempt: 1,
      chunk: { type: 'COMPLETED', finishReason: 'stop' },
    })

    expect(emitted).toEqual([
      {
        eventType: 'model.trace',
        payload: {
          modelCallId: 'model_call_1',
          attempt: 1,
          phase: 'REQUEST_DISPATCHED',
          ...traceContext,
        },
      },
      {
        eventType: 'model.preview.reset',
        payload: { modelCallId: 'model_call_1', attempt: 1 },
      },
      {
        eventType: 'model.trace',
        payload: {
          modelCallId: 'model_call_1',
          attempt: 1,
          phase: 'FIRST_PROVIDER_CHUNK',
          chunkType: 'OUTPUT',
        },
      },
      {
        eventType: 'model.preview.delta',
        payload: { modelCallId: 'model_call_1', attempt: 1, delta: '第一版\n结论' },
      },
      {
        eventType: 'model.trace',
        payload: {
          modelCallId: 'model_call_1',
          attempt: 1,
          phase: 'PROVIDER_COMPLETED',
          finishReason: 'stop',
        },
      },
      {
        eventType: 'model.trace',
        payload: { modelCallId: 'model_call_1', attempt: 2, phase: 'STRUCTURED_REPAIR' },
      },
      {
        eventType: 'model.preview.reset',
        payload: { modelCallId: 'model_call_1', attempt: 2 },
      },
      {
        eventType: 'model.trace',
        payload: {
          modelCallId: 'model_call_1',
          attempt: 2,
          phase: 'FIRST_PROVIDER_CHUNK',
          chunkType: 'OUTPUT',
        },
      },
      {
        eventType: 'model.preview.delta',
        payload: { modelCallId: 'model_call_1', attempt: 2, delta: '修复版' },
      },
      {
        eventType: 'model.trace',
        payload: {
          modelCallId: 'model_call_1',
          attempt: 2,
          phase: 'PROVIDER_COMPLETED',
          finishReason: 'stop',
        },
      },
    ])
  })
})

describe('JsonStringFieldExtractor', () => {
  it('跨分片解码 JSON escape、Unicode 和代理对，且不误取其他字符串字段', () => {
    const extractor = new JsonStringFieldExtractor('markdown', 8_000)
    const output = [
      extractor.push('{"note":"markdown: ignore","markdown":"行情\\n'),
      extractor.push('结论：\\"稳健\\"，'),
      extractor.push('代码\\u4E2D\\u6587，表情\\uD83D'),
      extractor.push('\\uDE00","claims":[]}'),
    ].join('')

    expect(output).toBe('行情\n结论："稳健"，代码中文，表情😀')
  })

  it('字段不是 JSON string 时失败关闭，不把未知结构公开为草稿', () => {
    const extractor = new JsonStringFieldExtractor('markdown', 8_000)

    expect(extractor.push('{"markdown":{"private":"value"}}')).toBe('')
    expect(extractor.push('{"markdown":"later"}')).toBe('')
  })
})
