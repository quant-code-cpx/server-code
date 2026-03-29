export const PUBLIC_KEY = 'isPublic'

/** Redis key prefixes for authentication */
export const REDIS_KEY = {
  /** 图片验证码，TTL 60s。format: auth:captcha:{captchaId} */
  CAPTCHA: (id: string) => `auth:captcha:${id}`,
  /** 登录失败次数，TTL 5min。format: auth:login:fail:{account} */
  LOGIN_FAIL: (account: string) => `auth:login:fail:${account}`,
  /** 账号锁定标志，TTL 10min。format: auth:login:lock:{account} */
  LOGIN_LOCK: (account: string) => `auth:login:lock:${account}`,
  /** Refresh Token 凭证，TTL = refresh token 有效期。format: auth:refresh:{userId}:{jti} */
  REFRESH_TOKEN: (userId: number, jti: string) => `auth:refresh:${userId}:${jti}`,
  /** Access Token 黑名单，TTL = access token 剩余有效期。format: auth:blacklist:{jti} */
  TOKEN_BLACKLIST: (jti: string) => `auth:blacklist:${jti}`,
} as const

/** 登录最大失败次数（5 次） */
export const LOGIN_MAX_FAIL = 5
/** 登录失败计数窗口（5 分钟，秒） */
export const LOGIN_FAIL_WINDOW = 300
/** 账号锁定时长（10 分钟，秒） */
export const LOGIN_LOCK_DURATION = 600
/** 图片验证码有效期（60 秒） */
export const CAPTCHA_TTL = 60
/** Refresh Token cookie 名称 */
export const REFRESH_TOKEN_COOKIE = 'refresh_token'
/** Refresh Token 轮换宽限期（秒）。旧 Token 使用后短暂保留，防止 React StrictMode 双 useEffect 被误判为重放攻击 */
export const REFRESH_TOKEN_GRACE = 10
