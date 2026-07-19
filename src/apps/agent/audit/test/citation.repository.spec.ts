import { AiSearchFetchStatus, AiSourceType } from '@prisma/client'
import { AgentAuditNotFoundError } from '../agent-audit.repository'
import { CitationRepository } from '../citation.repository'

describe('CitationRepository', () => {
  it('按 sourceId 读取搜索来源并规范化输入', async () => {
    const source = {
      id: 'source_1',
      sourceType: AiSourceType.OFFICIAL,
      canonicalUrl: 'https://example.com/notice',
      fetchStatus: AiSearchFetchStatus.FETCHED,
    }
    const prisma = { aiSearchSource: { findUnique: jest.fn().mockResolvedValue(source) } }
    const repository = new CitationRepository(prisma as never, { log: jest.fn() } as never)

    await expect(repository.findSearchSourceById(' source_1 ')).resolves.toBe(source)
    expect(prisma.aiSearchSource.findUnique).toHaveBeenCalledWith({ where: { id: 'source_1' } })
  })

  it('来源不存在时返回统一 not found，不泄露数据库细节', async () => {
    const prisma = { aiSearchSource: { findUnique: jest.fn().mockResolvedValue(null) } }
    const repository = new CitationRepository(prisma as never, { log: jest.fn() } as never)

    await expect(repository.findSearchSourceById('missing')).rejects.toBeInstanceOf(AgentAuditNotFoundError)
  })
})
