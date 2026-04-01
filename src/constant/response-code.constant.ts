export enum ErrorEnum {
  SERVER_ERROR = '500:服务繁忙，请稍后再试',

  VALIDATION_ERROR = '9001:请求参数校验失败',
  INVALID_DATE_RANGE = '9002:日期范围不合法',

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
  CANNOT_OPERATE_SUPER_ADMIN = '2013:超级管理员账号不允许被编辑、禁用、重置密码或删除',

  TUSHARE_CONFIG_MISSING = '3001:Tushare 配置缺失',
  TUSHARE_API_ERROR = '3002:Tushare 接口调用失败',
  TUSHARE_TARGET_TRADE_DATE_REQUIRED = '3003:Tushare 同步缺少目标交易日',
  TUSHARE_SYNC_PLAN_DUPLICATE = '3004:Tushare 同步任务注册重复',

  BACKTEST_INVALID_STRATEGY_CONFIG = '4001:回测策略配置不合法',
  BACKTEST_NO_TRADING_DAYS = '4002:指定区间内无可用交易日',
  BACKTEST_UNKNOWN_STRATEGY = '4003:未知的回测策略类型',
  BACKTEST_UNKNOWN_JOB = '4004:未知的回测任务类型',
}

export const SUCCESS_CODE = 0
