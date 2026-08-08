const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER)

/**
 * Preserve existing numeric JSON values when exact, and avoid silently
 * corrupting values outside JavaScript's safe integer range.
 */
export function serializeBigIntForJson(value: bigint): number | string {
  if (value >= MIN_SAFE_BIGINT && value <= MAX_SAFE_BIGINT) return Number(value)
  return value.toString()
}
