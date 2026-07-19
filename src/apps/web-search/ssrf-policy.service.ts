import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import { WebSearchError } from './web-search.errors'

export const WEB_DNS_RESOLVER = Symbol('WEB_DNS_RESOLVER')

export interface ResolvedWebAddress {
  address: string
  family: 4 | 6
}

export interface WebDnsResolver {
  resolve(hostname: string): Promise<ResolvedWebAddress[]>
}

export interface SsrfFixturePolicy {
  allowHttp: true
  hosts: readonly string[]
}

export class NodeWebDnsResolver implements WebDnsResolver {
  async resolve(hostname: string): Promise<ResolvedWebAddress[]> {
    const rows = await dns.lookup(hostname, { all: true, verbatim: true })
    return rows.map((row) => ({ address: row.address, family: row.family === 6 ? 6 : 4 }))
  }
}

export class SsrfPolicyService {
  private readonly fixtureHosts: ReadonlySet<string>

  constructor(
    private readonly resolver: WebDnsResolver,
    private readonly fixturePolicy?: SsrfFixturePolicy,
  ) {
    this.fixtureHosts = new Set((fixturePolicy?.hosts ?? []).map(normalizeHostname))
  }

  parseAndAssert(rawUrl: string): URL {
    let url: URL
    try {
      url = new URL(rawUrl.trim())
    } catch {
      throw new WebSearchError('INVALID_ARGUMENT', '网页 URL 无效')
    }
    if (url.toString().length > 4_096) throw new WebSearchError('INVALID_ARGUMENT', '网页 URL 超过长度限制')
    if (url.username || url.password) throw new WebSearchError('BLOCKED', '网页 URL 禁止 userinfo')
    const hostname = normalizeHostname(url.hostname)
    if (!hostname || hostname.length > 253) throw new WebSearchError('BLOCKED', '网页 hostname 无效')
    url.hostname = hostname
    url.hash = ''

    const fixture = this.isFixture(url)
    if (url.protocol !== 'https:' && !fixture) throw new WebSearchError('BLOCKED', '生产网页抓取仅允许 HTTPS')
    if (url.protocol === 'https:' && url.port && url.port !== '443') {
      throw new WebSearchError('BLOCKED', 'HTTPS 网页抓取仅允许默认端口')
    }
    if (url.protocol === 'http:' && !fixture) throw new WebSearchError('BLOCKED', 'HTTP 仅允许隔离测试 fixture')
    const literalFamily = isIP(stripIpv6Brackets(hostname))
    if (!fixture && literalFamily && !isPublicAddress(stripIpv6Brackets(hostname))) {
      throw new WebSearchError('BLOCKED', '网页 IP 地址被 SSRF policy 拒绝')
    }
    if (!fixture && isBlockedHostname(hostname))
      throw new WebSearchError('BLOCKED', '网页 hostname 被 SSRF policy 拒绝')
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new WebSearchError('BLOCKED', '网页协议被拒绝')
    return url
  }

  async resolveAndAssert(url: URL): Promise<ResolvedWebAddress[]> {
    const hostname = normalizeHostname(url.hostname)
    const literalFamily = isIP(stripIpv6Brackets(hostname))
    let addresses: ResolvedWebAddress[]
    try {
      addresses = literalFamily
        ? [{ address: stripIpv6Brackets(hostname), family: literalFamily as 4 | 6 }]
        : await this.resolver.resolve(hostname)
    } catch {
      throw new WebSearchError('UPSTREAM_FAILED', '网页 DNS 解析失败', true)
    }
    if (!addresses.length) throw new WebSearchError('UPSTREAM_FAILED', '网页 DNS 未返回地址', true)
    if (!this.isFixture(url)) {
      for (const row of addresses) {
        if (
          (row.family !== 4 && row.family !== 6) ||
          isIP(row.address) !== row.family ||
          !isPublicAddress(row.address)
        ) {
          throw new WebSearchError('BLOCKED', '网页 DNS 解析到非公网地址')
        }
      }
    }
    return deduplicateAddresses(addresses)
  }

  private isFixture(url: URL): boolean {
    return Boolean(
      this.fixturePolicy?.allowHttp &&
      url.protocol === 'http:' &&
      this.fixtureHosts.has(normalizeHostname(url.hostname)),
    )
  }
}

function normalizeHostname(value: string): string {
  const withoutBrackets = stripIpv6Brackets(value.trim().toLowerCase().replace(/\.$/, ''))
  if (isIP(withoutBrackets)) return withoutBrackets
  return domainToASCII(withoutBrackets).toLowerCase()
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.invalid') ||
    hostname.endsWith('.example') ||
    hostname === 'metadata.google.internal'
  )
}

function deduplicateAddresses(addresses: ResolvedWebAddress[]): ResolvedWebAddress[] {
  const seen = new Set<string>()
  return addresses.filter((row) => {
    const key = `${row.family}:${row.address}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family === 6) return isPublicIpv6(address)
  return false
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false
  const [a, b, c] = octets
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 0 && c === 0) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 192 && b === 88 && c === 99) return false
  if (a === 192 && b === 168) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function isPublicIpv6(address: string): boolean {
  const groups = expandIpv6(address)
  if (!groups) return false
  if (groups.slice(0, 5).every((value) => value === 0) && groups[5] === 0xffff) {
    return isPublicIpv4(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`)
  }
  if (groups.every((value) => value === 0) || (groups.slice(0, 7).every((value) => value === 0) && groups[7] === 1)) {
    return false
  }
  const first = groups[0]
  if ((first & 0xfe00) === 0xfc00) return false
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return false
  if ((first & 0xff00) === 0xff00) return false
  if (first === 0x2001 && groups[1] === 0x0db8) return false
  if (first === 0x2001 && (groups[1] === 0x0002 || (groups[1] >= 0x0010 && groups[1] <= 0x001f))) return false
  if (first === 0x2002) return false
  if (first === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((value) => value === 0)) return false
  if (first === 0x0100 && groups.slice(1, 4).every((value) => value === 0)) return false
  return true
}

function expandIpv6(address: string): number[] | null {
  const normalized = address.toLowerCase().split('%')[0]
  if (!normalized || normalized.includes('.')) return null
  const pieces = normalized.split('::')
  if (pieces.length > 2) return null
  const left = pieces[0] ? pieces[0].split(':') : []
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(':') : []
  if (pieces.length === 1 && left.length !== 8) return null
  const missing = 8 - left.length - right.length
  if (missing < 0 || (pieces.length === 2 && missing < 1)) return null
  const groups = [...left, ...Array(missing).fill('0'), ...right].map((value) => Number.parseInt(value, 16))
  if (groups.length !== 8 || groups.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff))
    return null
  return groups
}
