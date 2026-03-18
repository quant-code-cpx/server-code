export enum ErrorEnum {
  SERVER_ERROR = '500:服务繁忙，请稍后再试',

  INVALID_USERNAME_PASSWORD = '1001:用户名或密码有误',
  ACCESS_TOKEN_EXPIRED = '1002:访问令牌已过期',
  REFRESH_TOKEN_EXPIRED = '1003:刷新令牌已过期',

  USER_ALREADY_EXISTS = '2001:用户已存在',
  USER_NOT_FOUND = '2002:用户不存在',
  INVALID_PASSWORD = '2003:密码有误',
  USER_DISABLED = '2004:账号已被禁用',
}

export const SUCCESS_CODE = 0
