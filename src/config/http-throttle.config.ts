export interface HttpThrottleEnvironment {
  HTTP_THROTTLE_LIMIT?: string
  HTTP_THROTTLE_TTL_MS?: string
}

export interface HttpThrottleConfig {
  ttlMs: number
  limit: number
}

export function buildHttpThrottleConfig(_env: HttpThrottleEnvironment): HttpThrottleConfig {
  return {
    ttlMs: parseInteger(_env.HTTP_THROTTLE_TTL_MS, 10_000, 1_000, 3_600_000, 'HTTP_THROTTLE_TTL_MS'),
    limit: parseInteger(_env.HTTP_THROTTLE_LIMIT, 20, 1, 1_000_000, 'HTTP_THROTTLE_LIMIT'),
  }
}

function parseInteger(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (!raw?.trim()) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 的整数`)
  }
  return value
}
