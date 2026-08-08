import { sanitizeAuditErrorMessage, sanitizeAuditPayload } from '../agent-audit-sanitizer'

describe('Agent audit error sanitizer', () => {
  it('脱敏嵌入式 Redis URL 凭据和敏感 query，同时保留故障分类', () => {
    const result = sanitizeAuditErrorMessage(
      'connect redis://default:super-secret@127.0.0.1:6379/0?token=queue-token ECONNREFUSED',
    )

    expect(result).toBe('connect redis://[REDACTED]@127.0.0.1:6379/0?token=[REDACTED] ECONNREFUSED')
    expect(result).not.toContain('super-secret')
    expect(result).not.toContain('queue-token')
  })

  it('[REG] Token 计数和模型输出上限是可观测能力字段，不得按凭据脱敏', () => {
    expect(
      sanitizeAuditPayload({
        maxOutputTokens: 32_768,
        maxInputTokens: 64_000,
        maxCumulativeInputTokens: 128_000,
        inputTokenCountSource: 'OPENAI_INPUT_TOKENS_API',
        contextTokenCount: 6_397,
        sourceTokenCount: 5_000,
        accessToken: 'secret-access-token',
        confirmationToken: 'secret-confirmation-token',
      }),
    ).toEqual({
      accessToken: '[REDACTED]',
      confirmationToken: '[REDACTED]',
      contextTokenCount: 6_397,
      maxInputTokens: 64_000,
      maxCumulativeInputTokens: 128_000,
      inputTokenCountSource: 'OPENAI_INPUT_TOKENS_API',
      maxOutputTokens: 32_768,
      sourceTokenCount: 5_000,
    })
  })
})
