import { createHash } from 'node:crypto'
import type { RetrievalSourceType } from './retrieval.port'

export interface RetrievalChunk {
  chunkIndex: number
  content: string
  contentHash: string
}

export interface ChunkRetrievalSourceInput {
  sourceType: RetrievalSourceType
  sourceId: string
  content: string
  version: string
  maxChars: number
  overlapChars: number
}

export function chunkRetrievalSource(input: ChunkRetrievalSourceInput): RetrievalChunk[] {
  const normalized = normalizeContent(input.content)
  if (!normalized) return []
  if (!Number.isInteger(input.maxChars) || input.maxChars < 1) throw new Error('chunk maxChars 必须为正整数')
  if (!Number.isInteger(input.overlapChars) || input.overlapChars < 0 || input.overlapChars >= input.maxChars) {
    throw new Error('chunk overlapChars 非法')
  }

  const chunks: RetrievalChunk[] = []
  let start = 0
  while (start < normalized.length) {
    let end = Math.min(start + input.maxChars, normalized.length)
    if (end < normalized.length) end = preferredBoundary(normalized, start, end)
    const content = normalized.slice(start, end).trim()
    if (content) {
      const chunkIndex = chunks.length
      chunks.push({
        chunkIndex,
        content,
        contentHash: sha256(
          [input.version, input.sourceType, input.sourceId, String(chunkIndex), content].join('\u0000'),
        ),
      })
    }
    if (end >= normalized.length) break
    const next = Math.max(start + 1, end - input.overlapChars)
    start = skipWhitespace(normalized, next)
  }
  return chunks
}

export function selectBestLexicalChunk(chunks: readonly RetrievalChunk[], query: string): RetrievalChunk | null {
  if (chunks.length === 0) return null
  const terms = lexicalTerms(query)
  if (terms.length === 0) return chunks[0]
  return chunks.reduce((best, chunk) => {
    const score = lexicalTerms(chunk.content).reduce((sum, term) => sum + (terms.includes(term) ? 1 : 0), 0)
    const bestScore = lexicalTerms(best.content).reduce((sum, term) => sum + (terms.includes(term) ? 1 : 0), 0)
    return score > bestScore ? chunk : best
  })
}

export function lexicalTerms(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase()
  const ascii = normalized.match(/[a-z0-9_.-]{2,}/g) ?? []
  const hanSequences = normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []
  const hanBigrams = hanSequences.flatMap((sequence) =>
    Array.from({ length: Math.max(0, sequence.length - 1) }, (_, index) => sequence.slice(index, index + 2)),
  )
  return [...new Set([...ascii, ...hanSequences, ...hanBigrams])]
}

function normalizeContent(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function preferredBoundary(value: string, start: number, end: number): number {
  const minimum = start + Math.floor((end - start) * 0.6)
  for (const separator of ['\n\n', '\n', '。', '；', ';', ' ']) {
    const boundary = value.lastIndexOf(separator, end)
    if (boundary >= minimum) return boundary + separator.length
  }
  return end
}

function skipWhitespace(value: string, index: number): number {
  let cursor = index
  while (cursor < value.length && /\s/.test(value[cursor])) cursor += 1
  return cursor
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
