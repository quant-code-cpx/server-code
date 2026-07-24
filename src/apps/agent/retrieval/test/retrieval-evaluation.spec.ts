import { buildAgentRetrievalConfig } from 'src/config/agent-retrieval.config'
import { evaluateRetrievalPilot } from '../retrieval-evaluation'
import { chunkRetrievalSource } from '../retrieval-chunker'

describe('Retrieval pilot evaluation', () => {
  it('[BIZ] 匿名 gold set 独立计算 FTS 与 hybrid Recall@K/MRR，并因真实运行门禁缺失得出 no-go', () => {
    const result = evaluateRetrievalPilot(process.cwd())

    expect(result.dataset.queryCount).toBe(8)
    expect(result.strategies.hybrid.recallAtK).toBeGreaterThan(result.strategies.fts.recallAtK)
    expect(result.strategies.hybrid.mrr).toBeGreaterThan(result.strategies.fts.mrr)
    expect(result.qualityGate.pass).toBe(true)
    expect(result.safetyGate.pass).toBe(true)
    expect(result.operationalGate.pass).toBe(false)
    expect(result.operationalGate.failures).toEqual(
      expect.arrayContaining([expect.stringContaining('embedding model'), expect.stringContaining('41GB clone')]),
    )
    expect(result.decision).toBe('no-go')
  })

  it('[BIZ] 相同 source/version/chunk 参数产生稳定 hash；正文或版本变化使旧 chunk 可识别为 stale', () => {
    const config = buildAgentRetrievalConfig({})
    const input = {
      sourceType: 'REPORT' as const,
      sourceId: 'report_1',
      content: '第一段研究结论。\n\n第二段风险说明。'.repeat(100),
      version: config.chunkVersion,
      maxChars: 300,
      overlapChars: 40,
    }
    const first = chunkRetrievalSource(input)
    const repeated = chunkRetrievalSource(input)
    const changed = chunkRetrievalSource({ ...input, content: `${input.content}新增结论。` })
    const upgraded = chunkRetrievalSource({ ...input, version: 'retrieval-chunk-v2' })

    expect(first.length).toBeGreaterThan(1)
    expect(repeated).toEqual(first)
    expect(changed.at(-1)?.contentHash).not.toBe(first.at(-1)?.contentHash)
    expect(upgraded.map((chunk) => chunk.contentHash)).not.toEqual(first.map((chunk) => chunk.contentHash))
    expect(new Set(first.map((chunk) => chunk.contentHash)).size).toBe(first.length)
  })
})
