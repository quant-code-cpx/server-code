import { sanitizeAuditErrorMessage } from '../agent-audit-sanitizer'

describe('Agent audit error sanitizer', () => {
  it('脱敏嵌入式 Redis URL 凭据和敏感 query，同时保留故障分类', () => {
    const result = sanitizeAuditErrorMessage(
      'connect redis://default:super-secret@127.0.0.1:6379/0?token=queue-token ECONNREFUSED',
    )

    expect(result).toBe('connect redis://[REDACTED]@127.0.0.1:6379/0?token=[REDACTED] ECONNREFUSED')
    expect(result).not.toContain('super-secret')
    expect(result).not.toContain('queue-token')
  })
})
