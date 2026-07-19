import { Injectable } from '@nestjs/common'
import { AiSourceType } from '@prisma/client'
import type { WebSourceType } from './web-search.provider'

const EXCHANGE_HOSTS = ['sse.com.cn', 'szse.cn', 'bse.cn', 'hkex.com.hk']
const REGULATOR_HOSTS = ['csrc.gov.cn', 'pbc.gov.cn', 'safe.gov.cn', 'stats.gov.cn', 'gov.cn']
const MEDIA_HOSTS = ['reuters.com', 'bloomberg.com', 'wsj.com', 'ft.com', 'xinhuanet.com', 'people.com.cn']
const INSTITUTION_HOSTS = ['imf.org', 'worldbank.org', 'bis.org', 'oecd.org', 'cf40.org.cn']

@Injectable()
export class SourceClassifierService {
  classify(url: URL, publisher?: string | null): WebSourceType {
    const hostname = url.hostname.toLowerCase()
    if (matchesHost(hostname, EXCHANGE_HOSTS)) return 'EXCHANGE'
    if (matchesHost(hostname, REGULATOR_HOSTS)) return 'REGULATOR'
    if (matchesHost(hostname, MEDIA_HOSTS)) return 'MEDIA'
    if (matchesHost(hostname, INSTITUTION_HOSTS)) return 'INSTITUTION'
    if (/证券交易所|监管|委员会|人民政府|央行|统计局/u.test(publisher ?? '')) return 'OFFICIAL'
    if (/股份有限公司|有限责任公司|公司官网|投资者关系/u.test(publisher ?? '')) return 'COMPANY'
    if (/研究院|研究所|证券|基金|银行|大学|协会/u.test(publisher ?? '')) return 'INSTITUTION'
    return 'MEDIA'
  }

  toPersistenceType(sourceType: WebSourceType): AiSourceType {
    if (sourceType === 'MEDIA') return AiSourceType.MEDIA
    if (sourceType === 'INSTITUTION') return AiSourceType.INSTITUTION
    return AiSourceType.OFFICIAL
  }

  fromPersistenceType(sourceType: AiSourceType, metadataType?: unknown): WebSourceType {
    if (isWebSourceType(metadataType)) return metadataType
    if (sourceType === AiSourceType.MEDIA) return 'MEDIA'
    if (sourceType === AiSourceType.INSTITUTION) return 'INSTITUTION'
    return 'OFFICIAL'
  }
}

function matchesHost(hostname: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
}

function isWebSourceType(value: unknown): value is WebSourceType {
  return ['OFFICIAL', 'EXCHANGE', 'REGULATOR', 'COMPANY', 'MEDIA', 'INSTITUTION'].includes(String(value))
}
