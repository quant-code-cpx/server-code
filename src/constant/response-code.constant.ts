export enum ErrorEnum {
  SERVER_ERROR = '500:服务繁忙，请稍后再试',

  INVALID_USERNAME_PASSWORD = '1001:用户名或密码有误',
  ACCESS_TOKEN_EXPIRED = '1002:访问令牌已过期',
  REFRESH_TOKEN_EXPIRED = '1003:刷新令牌已过期',
  INVALID_CAPTCHA = '1004:验证码有误或已过期',
  ACCOUNT_LOCKED = '1005:账号已被锁定，请 10 分钟后重试',
  INVALID_REFRESH_TOKEN = '1006:刷新令牌无效或已过期，请重新登录',

  USER_ALREADY_EXISTS = '2001:用户已存在',
  USER_NOT_FOUND = '2002:用户不存在',
  INVALID_PASSWORD = '2003:密码有误',
  USER_DISABLED = '2004:账号已被禁用',
  FORBIDDEN = '2005:权限不足',
  CANNOT_CREATE_HIGHER_ROLE = '2006:不能创建高于或等于自身角色的账号',
  CANNOT_OPERATE_HIGHER_ROLE = '2007:无法操作同级或更高级别的用户',
  SUPER_ADMIN_UNIQUE = '2008:超级管理员有且仅有一个，不可重复创建',
  CANNOT_DELETE_SELF = '2009:不能删除自己的账号',
  CANNOT_DISABLE_SELF = '2010:不能禁用自己的账号',
  PASSWORD_TOO_SHORT = '2011:密码不能少于8位',
  SUPER_ADMIN_CANNOT_CHANGE_ROLE = '2012:超级管理员角色不可更改',
}

export const SUCCESS_CODE = 0
