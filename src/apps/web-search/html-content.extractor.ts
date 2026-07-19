import { Injectable } from '@nestjs/common'
import { sha256 } from 'src/apps/agent/audit/agent-audit-sanitizer'
import type { SafeWebFetchResponse } from './safe-web-fetcher.service'

export type WebExtractMode = 'ARTICLE' | 'VISIBLE_TEXT' | 'METADATA_ONLY'

export interface ExtractedSectionLocator {
  sectionId: string
  heading: string | null
  paragraphStart: number
  paragraphEnd: number
  startOffset: number
  endOffset: number
}

export interface ExtractedWebContent {
  title: string | null
  publisher: string | null
  author: string | null
  publishedAt: Date | null
  language: string | null
  contentHash: string
  text: string
  sections: ExtractedSectionLocator[]
  truncated: boolean
  extractionVersion: string
  riskFlags: string[]
  warnings: string[]
}

const EXTRACTION_VERSION = 'html-text-v1'
const HEADING_START = '__WEB_HEADING_START__'
const HEADING_END = '__WEB_HEADING_END__'

@Injectable()
export class HtmlContentExtractor {
  extract(document: SafeWebFetchResponse, maxCharacters: number, mode: WebExtractMode): ExtractedWebContent {
    const warnings: string[] = []
    const decoded = decodeText(document.body, document.charset, warnings)
    const metadata = extractMetadata(decoded)
    const source = document.contentType === 'text/plain' ? decoded : selectHtmlRegion(decoded, mode)
    const paragraphs = document.contentType === 'text/plain' ? plainParagraphs(source) : htmlParagraphs(source)
    const assembled = assembleText(paragraphs)
    const fullText = assembled.text
    if (!fullText) warnings.push('EMPTY_CONTENT')
    const contentHash = sha256(fullText)
    const visibleText = mode === 'METADATA_ONLY' ? '' : truncateText(fullText, maxCharacters)
    const truncated = mode !== 'METADATA_ONLY' && visibleText.length < fullText.length
    const sections = mode === 'METADATA_ONLY' ? [] : clipLocators(assembled.sections, visibleText.length)
    if (truncated) warnings.push('CONTENT_TRUNCATED')
    const riskFlags = detectPromptInjection(`${metadata.title ?? ''}\n${metadata.publisher ?? ''}\n${fullText}`)
    if (riskFlags.length) warnings.push('PROMPT_INJECTION_SUSPECTED')

    return {
      ...metadata,
      contentHash,
      text: visibleText,
      sections,
      truncated,
      extractionVersion: EXTRACTION_VERSION,
      riskFlags,
      warnings: [...new Set(warnings)],
    }
  }
}

interface Paragraph {
  text: string
  heading: string | null
  index: number
}

function decodeText(body: Buffer, charset: string | null, warnings: string[]): string {
  try {
    return new TextDecoder(charset || 'utf-8', { fatal: true }).decode(body)
  } catch {
    warnings.push('CHARSET_FALLBACK_UTF8')
    return new TextDecoder('utf-8').decode(body)
  }
}

function extractMetadata(
  html: string,
): Pick<ExtractedWebContent, 'title' | 'publisher' | 'author' | 'publishedAt' | 'language'> {
  const title =
    cleanInline(firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i)) ||
    cleanInline(firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i)) ||
    null
  const publisher = metaContent(html, ['property:og:site_name', 'name:application-name'])
  const author = metaContent(html, ['name:author', 'property:article:author'])
  const publishedRaw =
    metaContent(html, ['property:article:published_time', 'name:date', 'itemprop:datepublished']) ??
    attributeValue(firstMatch(html, /<time\b([^>]*)>/i), 'datetime')
  const publishedAt = publishedRaw ? parseDate(publishedRaw) : null
  const htmlAttributes = firstMatch(html, /<html\b([^>]*)>/i)
  const language = attributeValue(htmlAttributes, 'lang')
  return { title, publisher, author, publishedAt, language }
}

function selectHtmlRegion(html: string, mode: WebExtractMode): string {
  if (mode !== 'ARTICLE') return firstMatch(html, /<body\b[^>]*>([\s\S]*?)<\/body>/i) || html
  return (
    firstMatch(html, /<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
    firstMatch(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
    firstMatch(html, /<body\b[^>]*>([\s\S]*?)<\/body>/i) ||
    html
  )
}

function htmlParagraphs(html: string): Paragraph[] {
  let value = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(script|style|noscript|template|svg|form|button|select|textarea|object|embed|iframe|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      ' ',
    )
    .replace(/<(input|link|meta)\b[^>]*>/gi, ' ')
    .replace(
      /<([a-z0-9]+)\b[^>]*(?:hidden|aria-hidden\s*=\s*["']?true|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden))[^>]*>[\s\S]*?<\/\1\s*>/gi,
      ' ',
    )
    .replace(
      /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi,
      (_, text: string) => `\n${HEADING_START}${cleanInline(text)}${HEADING_END}\n`,
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|aside|header|footer|li|ul|ol|tr|table|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  value = decodeEntities(value).replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
  const paragraphs: Paragraph[] = []
  let heading: string | null = null
  for (const raw of value.split(/\n+/)) {
    const line = normalizeWhitespace(raw)
    if (!line) continue
    if (line.startsWith(HEADING_START) && line.endsWith(HEADING_END)) {
      heading = normalizeWhitespace(line.slice(HEADING_START.length, -HEADING_END.length)) || null
      if (heading) paragraphs.push({ text: heading, heading, index: paragraphs.length })
      continue
    }
    paragraphs.push({ text: line, heading, index: paragraphs.length })
  }
  return paragraphs
}

function plainParagraphs(value: string): Paragraph[] {
  return value
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .split(/\n\s*\n|\r?\n/)
    .map(normalizeWhitespace)
    .filter(Boolean)
    .map((text, index) => ({ text, heading: null, index }))
}

function assembleText(paragraphs: Paragraph[]): { text: string; sections: ExtractedSectionLocator[] } {
  const pieces: string[] = []
  const rawLocators: ExtractedSectionLocator[] = []
  let offset = 0
  for (const paragraph of paragraphs) {
    if (pieces.length) offset += 2
    const startOffset = offset
    pieces.push(paragraph.text)
    offset += paragraph.text.length
    rawLocators.push({
      sectionId: `section-${rawLocators.length + 1}`,
      heading: paragraph.heading,
      paragraphStart: paragraph.index,
      paragraphEnd: paragraph.index,
      startOffset,
      endOffset: offset,
    })
  }
  if (rawLocators.length <= 200) return { text: pieces.join('\n\n'), sections: rawLocators }
  const chunkSize = Math.ceil(rawLocators.length / 200)
  const sections: ExtractedSectionLocator[] = []
  for (let index = 0; index < rawLocators.length; index += chunkSize) {
    const chunk = rawLocators.slice(index, index + chunkSize)
    sections.push({
      sectionId: `section-${sections.length + 1}`,
      heading: chunk.find((item) => item.heading)?.heading ?? null,
      paragraphStart: chunk[0].paragraphStart,
      paragraphEnd: chunk.at(-1)!.paragraphEnd,
      startOffset: chunk[0].startOffset,
      endOffset: chunk.at(-1)!.endOffset,
    })
  }
  return { text: pieces.join('\n\n'), sections }
}

function clipLocators(sections: ExtractedSectionLocator[], textLength: number): ExtractedSectionLocator[] {
  return sections
    .filter((section) => section.startOffset < textLength)
    .map((section) => ({ ...section, endOffset: Math.min(section.endOffset, textLength) }))
}

function truncateText(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  const candidate = value.slice(0, maximum)
  const boundary = candidate.lastIndexOf('\n\n')
  return candidate.slice(0, boundary >= Math.floor(maximum * 0.8) ? boundary : maximum).trimEnd()
}

function detectPromptInjection(text: string): string[] {
  const patterns = [
    /ignore (all |any )?(previous|prior) instructions?/i,
    /system prompt|developer message|reveal.{0,20}(secret|token|prompt)/i,
    /call (this |a )?tool|execute (this |the )?command/i,
    /忽略.{0,12}(之前|以上|先前).{0,8}(指令|要求)/u,
    /(系统提示词|开发者消息|调用工具|执行命令|泄露密钥)/u,
  ]
  return patterns.some((pattern) => pattern.test(text)) ? ['PROMPT_INJECTION_SUSPECTED'] : []
}

function metaContent(html: string, selectors: string[]): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const selector of selectors) {
    const separator = selector.indexOf(':')
    const attribute = selector.slice(0, separator)
    const expected = selector.slice(separator + 1)
    const tag = tags.find((candidate) => attributeValue(candidate, attribute)?.toLowerCase() === expected)
    const content = tag ? attributeValue(tag, 'content') : null
    if (content) return cleanInline(content) || null
  }
  return null
}

function attributeValue(tag: string | null, name: string): string | null {
  if (!tag) return null
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, 'i'))
  return decodeEntities(match?.[1] ?? match?.[2] ?? '').trim() || null
}

function firstMatch(value: string, pattern: RegExp): string {
  return value.match(pattern)?.[1] ?? ''
}

function cleanInline(value: string): string {
  return normalizeWhitespace(decodeEntities(value.replace(/<[^>]+>/g, ' ')))
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[\t\f\v ]+/g, ' ').trim()
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key.startsWith('#x')) return safeCodePoint(Number.parseInt(key.slice(2), 16), entity)
    if (key.startsWith('#')) return safeCodePoint(Number.parseInt(key.slice(1), 10), entity)
    return named[key.toLowerCase()] ?? entity
  })
}

function safeCodePoint(value: number, fallback: string): string {
  try {
    return Number.isInteger(value) && value >= 0 ? String.fromCodePoint(value) : fallback
  } catch {
    return fallback
  }
}

function parseDate(value: string): Date | null {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
