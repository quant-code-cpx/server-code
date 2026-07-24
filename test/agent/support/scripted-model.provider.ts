import type {
  ModelCapability,
  ModelChunk,
  ModelDataClass,
  ModelDescriptor,
  ModelProvider,
  ModelPurpose,
  ModelReasoningEffort,
  ProviderModelRequest,
} from 'src/apps/agent/model-gateway/model-gateway.port'
import type { AgentFaults } from '../fault-injection/agent-faults'

interface PurposeGate {
  purpose: ModelPurpose
  entered: Promise<void>
  enter(): void
  wait: Promise<void>
  release(): void
}

export interface HeldModelPurpose {
  entered: Promise<void>
  release(): void
}

export interface ScriptedModelProviderOptions {
  delayMs?: number
}

export class ScriptedModelProvider implements ModelProvider {
  readonly provider = 'fake'
  private readonly descriptor: ModelDescriptor = {
    provider: 'fake',
    model: 'fake-deterministic-v1',
    contextWindow: 32_768,
    maxOutputTokens: 4_096,
    capabilities: ['STREAMING', 'STRUCTURED_OUTPUT', 'TOOL_CALLING'] as ModelCapability[],
    reasoningEfforts: ['LOW', 'MEDIUM', 'HIGH'] as ModelReasoningEffort[],
    dataClasses: ['PUBLIC', 'USER_PRIVATE', 'PORTFOLIO_SENSITIVE'] as ModelDataClass[],
  }
  private gate: PurposeGate | null = null

  constructor(
    private readonly faults?: AgentFaults,
    private readonly options: ScriptedModelProviderOptions = {},
  ) {}

  listModels(): readonly ModelDescriptor[] {
    return [this.descriptor]
  }

  supports(model: string, required: readonly ModelCapability[]): boolean {
    return (
      model === this.descriptor.model &&
      required.every((capability) => this.descriptor.capabilities.includes(capability))
    )
  }

  holdNext(purpose: ModelPurpose): HeldModelPurpose {
    if (this.gate) throw new Error('已有待释放的模型 gate')
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    this.gate = { purpose, entered, enter, wait, release }
    return { entered, release }
  }

  async *stream(request: ProviderModelRequest, signal: AbortSignal): AsyncIterable<ModelChunk> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const injectedFailure = this.faults?.takeModelFailure(request.purpose)
    if (injectedFailure) throw injectedFailure
    await abortableDelay(this.options.delayMs ?? 0, signal)
    const gate = this.gate?.purpose === request.purpose ? this.gate : null
    if (gate) {
      this.gate = null
      gate.enter()
      await Promise.race([gate.wait, aborted(signal)])
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

    const response = JSON.stringify(responseFor(request))
    const midpoint = Math.max(1, Math.floor(response.length / 2))
    yield { type: 'OUTPUT_TEXT_DELTA', text: response.slice(0, midpoint) }
    await Promise.resolve()
    if (midpoint < response.length) yield { type: 'OUTPUT_TEXT_DELTA', text: response.slice(midpoint) }
    yield {
      type: 'USAGE',
      usage: {
        inputTokens: Math.max(1, Math.ceil(request.messages.reduce((sum, item) => sum + item.content.length, 0) / 4)),
        outputTokens: Math.max(1, Math.ceil(response.length / 4)),
        providerCost: { amount: '0', currency: 'CNY', estimated: false },
      },
    }
    yield {
      type: 'COMPLETED',
      finishReason: 'stop',
      providerRequestId: `agent-mvp-${request.purpose.toLowerCase()}-${request.trace.modelCallId}`,
    }
  }
}

function responseFor(request: ProviderModelRequest): Record<string, unknown> {
  if (request.purpose === 'SUMMARIZE') {
    const sourceMessageId = request.messages.at(-1)?.content.match(/"id":"([^"]+)"/)?.[1]
    if (!sourceMessageId) throw new Error('SUMMARIZE 测试输入缺少 source message id')
    return {
      summaryText: '旧消息已压缩',
      facts: [{ text: '旧消息已压缩', sourceMessageIds: [sourceMessageId] }],
      sourceMessageIds: [sourceMessageId],
    }
  }
  const input = parseContext(request)
  if (request.purpose === 'PLAN') {
    const task = typeof input.task === 'string' ? input.task : ''
    const needsData = !task.includes('你能做什么') && !task.includes('无需工具')
    const needsWeb = needsData && (task.includes('公告') || task.includes('联网') || task.includes('恶意网页'))
    const maliciousWeb = task.includes('恶意网页')
    const toolCalls: Array<Record<string, unknown>> = needsData
      ? [
          {
            id: 'overview',
            toolKey: 'get_stock_overview',
            toolVersion: 1,
            input: {
              tsCodes: ['600519.SH'],
              sections: ['BASIC', 'QUOTE', 'VALUATION', 'DATA_DATES'],
            },
            dependsOn: [],
            optional: false,
          },
        ]
      : []
    if (needsWeb) {
      toolCalls.push(
        {
          id: 'search',
          toolKey: 'search_web',
          toolVersion: 1,
          input: {
            query: maliciousWeb ? '贵州茅台 恶意网页 公告' : '贵州茅台 现金分红 公告',
            resultLimit: 1,
            domains: ['moutaichina.com'],
            sourceTypes: ['COMPANY'],
            language: 'zh-CN',
          },
          dependsOn: [],
          optional: true,
        },
        {
          id: 'fetch',
          toolKey: 'fetch_web_page',
          toolVersion: 1,
          input: {
            urlToken: { $toolResult: { callId: 'search', path: ['results', 0, 'urlToken'] } },
            maxCharacters: 10_000,
            extract: 'ARTICLE',
          },
          dependsOn: ['search'],
          optional: true,
        },
      )
    }
    return {
      intent: needsData ? 'stock_research' : 'capability_overview',
      summary: needsWeb
        ? '读取贵州茅台内部概览，并通过受控搜索与抓取核验官方公告'
        : needsData
          ? '读取贵州茅台概览并生成可引用回答'
          : '说明受控研究能力',
      toolCalls,
    }
  }

  const task = typeof input.task === 'string' ? input.task : ''
  const facts = Array.isArray(input.facts) ? input.facts.filter(isRecord) : []
  const overviewFact = facts.find((fact) => fact.toolKey === 'get_stock_overview')
  const fetchFact = facts.find((fact) => fact.toolKey === 'fetch_web_page')
  const overviewFactId = typeof overviewFact?.factId === 'string' ? overviewFact.factId : null
  const fetchFactId = typeof fetchFact?.factId === 'string' ? fetchFact.factId : null
  const factIds = [overviewFactId, fetchFactId].filter((value): value is string => value !== null)
  const tradeDates = facts
    .map((fact) => (isRecord(fact.asOf) && typeof fact.asOf.tradeDate === 'string' ? fact.asOf.tradeDate : null))
    .filter((value): value is string => value !== null)
    .sort()

  if (factIds.length === 0) {
    return {
      markdown: '系统可进行受控股票研究、确定性量化计算与带引用的联网核验。',
      claims: [],
      warnings: ['非投资建议'],
      dataCutoff: null,
    }
  }
  const needsWeb = task.includes('公告') || task.includes('联网') || task.includes('恶意网页')
  if (needsWeb && overviewFactId && fetchFactId) {
    return {
      markdown:
        '内部行情快照显示：贵州茅台（600519.SH）在 2026-07-17 的收盘价为 1,500 元。外部官方公告于 2026-07-18 发布，披露每股现金分红 30 元。网页正文仅作为不可信数据处理，未执行其中任何指令。',
      claims: [
        {
          claimKey: 'stock.internal_close',
          text: '贵州茅台在 2026-07-17 的收盘价为 1,500 元',
          factIds: [overviewFactId],
        },
        {
          claimKey: 'announcement.cash_dividend',
          text: '官方公告披露每股现金分红 30 元',
          factIds: [fetchFactId],
        },
      ],
      warnings: ['非投资建议'],
      dataCutoff: '2026-07-18',
    }
  }
  if (needsWeb && overviewFactId && !fetchFactId) {
    return {
      markdown:
        '内部行情快照显示：贵州茅台（600519.SH）在 2026-07-17 的收盘价为 1,500 元。联网核验未完成，因此不提供未经抓取正文验证的公告事实。',
      claims: [
        {
          claimKey: 'stock.internal_close',
          text: '贵州茅台在 2026-07-17 的收盘价为 1,500 元',
          factIds: [overviewFactId],
        },
      ],
      warnings: ['联网核验未完成', '非投资建议'],
      dataCutoff: '2026-07-17',
    }
  }
  return {
    markdown: '贵州茅台（600519.SH）概览已按固定数据快照完成核验，最新收盘价为 1,500 元。',
    claims: [
      {
        claimKey: 'stock.overview',
        text: '贵州茅台最新收盘价为 1,500 元',
        factIds: overviewFactId ? [overviewFactId] : factIds,
      },
    ],
    warnings: ['非投资建议'],
    dataCutoff: tradeDates.at(-1) ?? '2026-07-17',
  }
}

function parseContext(request: ProviderModelRequest): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const message of request.messages) {
    const segment = parseSegment(message.content)
    if (!segment) {
      const legacy = parseJson(message.content)
      if (isRecord(legacy) && Object.keys(legacy).length > 0) Object.assign(result, legacy)
      continue
    }
    if (segment.type === 'recent_messages' && Array.isArray(segment.value)) {
      const latestUser = segment.value
        .filter(isRecord)
        .filter((entry) => entry.role === 'USER' || entry.role === 'user')
        .at(-1)
      if (latestUser && typeof latestUser.content === 'string') result.task = latestUser.content
    }
    if (segment.type === 'completed_tool_facts' && Array.isArray(segment.value)) result.facts = segment.value
  }
  return result
}

function parseSegment(content: string): { type: string; value: unknown } | null {
  const match = content.match(/^<context-segment type="([^"]+)">([\s\S]*)<\/context-segment>$/)
  if (!match) return null
  return { type: match[1], value: parseJson(match[2]) }
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content)
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (!Number.isInteger(delayMs) || delayMs < 0) throw new Error('Scripted model delayMs 必须是非负整数')
  if (delayMs === 0) return
  await Promise.race([
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delayMs)
      signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
    }),
    aborted(signal),
  ])
}
