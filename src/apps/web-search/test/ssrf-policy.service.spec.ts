import { isPublicAddress, SsrfPolicyService } from '../ssrf-policy.service'

describe('SsrfPolicyService', () => {
  it('只允许 HTTPS 默认端口，拒绝 userinfo、本机域与危险 scheme', () => {
    const policy = new SsrfPolicyService({ resolve: jest.fn() })
    expect(policy.parseAndAssert('https://example.com/path#fragment').toString()).toBe('https://example.com/path')
    for (const url of [
      'http://example.com',
      'https://user:pass@example.com',
      'https://example.com:8443',
      'https://localhost',
      'https://127.0.0.1',
      'https://metadata.google.internal',
      'file:///etc/passwd',
    ]) {
      expect(() => policy.parseAndAssert(url)).toThrow()
    }
  })

  it('拒绝 loopback/private/link-local/metadata/IPv6 ULA 与 IPv4-mapped IPv6', () => {
    const blocked = [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '::',
      '::1',
      'fc00::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
      '::ffff:7f00:1',
    ]
    for (const address of blocked) expect(isPublicAddress(address)).toBe(false)
    expect(isPublicAddress('8.8.8.8')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
  })

  it('DNS 任一结果为私网即整体拒绝，避免 public+private 混合 rebinding', async () => {
    const policy = new SsrfPolicyService({
      resolve: jest.fn().mockResolvedValue([
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    })
    await expect(policy.resolveAndAssert(policy.parseAndAssert('https://example.com'))).rejects.toMatchObject({
      code: 'BLOCKED',
    })
  })

  it('HTTP 私网只可由构造参数注入精确 fixture host，非环境配置路径', async () => {
    const policy = new SsrfPolicyService({ resolve: jest.fn() }, { allowHttp: true, hosts: ['127.0.0.1'] })
    const url = policy.parseAndAssert('http://127.0.0.1:3210/fixture')
    await expect(policy.resolveAndAssert(url)).resolves.toEqual([{ address: '127.0.0.1', family: 4 }])
    expect(() => policy.parseAndAssert('http://localhost:3210/fixture')).toThrow('HTTP')
  })
})
