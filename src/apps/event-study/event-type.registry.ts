/** 系统支持的事件类型 */
export enum EventType {
  /** 业绩预告 */
  FORECAST = 'FORECAST',
  /** 分红除权 */
  DIVIDEND_EX = 'DIVIDEND_EX',
  /** 股东增持 */
  HOLDER_INCREASE = 'HOLDER_INCREASE',
  /** 股东减持 */
  HOLDER_DECREASE = 'HOLDER_DECREASE',
  /** 限售解禁 */
  SHARE_FLOAT = 'SHARE_FLOAT',
  /** 股票回购 */
  REPURCHASE = 'REPURCHASE',
  /** 非标审计 */
  AUDIT_QUALIFIED = 'AUDIT_QUALIFIED',
  /** 财报披露 */
  DISCLOSURE = 'DISCLOSURE',
}

/** 事件类型配置 */
export interface EventTypeConfig {
  type: EventType
  label: string
  description: string
}

export const EVENT_TYPE_CONFIGS: Record<EventType, EventTypeConfig> = {
  [EventType.FORECAST]: {
    type: EventType.FORECAST,
    label: '业绩预告',
    description: '业绩预告公告日前后超额收益',
  },
  [EventType.DIVIDEND_EX]: {
    type: EventType.DIVIDEND_EX,
    label: '分红除权',
    description: '除权除息日前后超额收益',
  },
  [EventType.HOLDER_INCREASE]: {
    type: EventType.HOLDER_INCREASE,
    label: '股东增持',
    description: '股东增持公告日前后超额收益',
  },
  [EventType.HOLDER_DECREASE]: {
    type: EventType.HOLDER_DECREASE,
    label: '股东减持',
    description: '股东减持公告日前后超额收益',
  },
  [EventType.SHARE_FLOAT]: {
    type: EventType.SHARE_FLOAT,
    label: '限售解禁',
    description: '限售股解禁日前后超额收益',
  },
  [EventType.REPURCHASE]: {
    type: EventType.REPURCHASE,
    label: '股票回购',
    description: '回购公告日前后超额收益',
  },
  [EventType.AUDIT_QUALIFIED]: {
    type: EventType.AUDIT_QUALIFIED,
    label: '非标审计',
    description: '非无保留意见审计结果公告后超额收益',
  },
  [EventType.DISCLOSURE]: {
    type: EventType.DISCLOSURE,
    label: '财报披露',
    description: '财报实际披露日前后超额收益',
  },
}
