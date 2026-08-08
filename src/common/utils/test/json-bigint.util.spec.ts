import { serializeBigIntForJson } from '../json-bigint.util'

describe('serializeBigIntForJson', () => {
  it('保留安全整数的 number JSON 契约', () => {
    expect(serializeBigIntForJson(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER)
    expect(serializeBigIntForJson(BigInt(Number.MIN_SAFE_INTEGER))).toBe(Number.MIN_SAFE_INTEGER)
  })

  it('超出安全整数范围时返回精确字符串', () => {
    expect(serializeBigIntForJson(9007199254740993n)).toBe('9007199254740993')
    expect(serializeBigIntForJson(-9007199254740992n)).toBe('-9007199254740992')
  })
})
