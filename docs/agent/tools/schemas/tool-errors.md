# Tool 错误 Schema

```ts
type ToolError = {
  ok: false;
  toolCallId: string;
  toolKey: string;
  toolVersion: number;
  code:
    | 'TOOL_NOT_REGISTERED'
    | 'INVALID_ARGUMENT'
    | 'PERMISSION_DENIED'
    | 'DATA_NOT_FOUND'
    | 'CONFIRMATION_REQUIRED'
    | 'QUOTA_EXCEEDED'
    | 'RATE_LIMITED'
    | 'TIMEOUT'
    | 'CANCELLED'
    | 'UPSTREAM_FAILED'
    | 'DATA_NOT_READY'
    | 'DATA_STALE'
    | 'DATA_QUALITY_FAILED'
    | 'OUTPUT_SCHEMA_INVALID'
    | 'RESULT_TOO_LARGE'
    | 'INTERNAL_ERROR';
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  details?: Record<string, string | number | boolean | null>;
};
```

## 分类规则

| code | HTTP/Agent 映射 | 自动重试 | 用户可见信息 |
| --- | --- | --- | --- |
| TOOL_NOT_REGISTERED | 6008 | 否 | 已发布 workflow 引用了未注册 Tool |
| INVALID_ARGUMENT | 6010 | 否 | 哪个输入字段不合法，不泄露内部 schema |
| PERMISSION_DENIED | 6009 | 否 | 无权限，不透露目标是否属于他人 |
| DATA_NOT_FOUND | 6013 | 否 | 截止时点没有数据或资源不可访问 |
| CONFIRMATION_REQUIRED | 6030 / workflow interrupt | 否 | 展示待确认动作和影响 |
| QUOTA_EXCEEDED | 6019 | 否 | 配额类型与重置时间 |
| RATE_LIMITED | 6026 | 是，有上限 | 可重试时间 |
| TIMEOUT | 6011 | 仅幂等 Tool | Tool 名和已重试次数 |
| DATA_NOT_READY | 6014 | 可延迟重试 | 所需水位与当前水位 |
| DATA_STALE | 6014 | 否 | 截止时间不满足任务要求 |
| DATA_QUALITY_FAILED | 6028 | 否 | 单位/完整性/点时性失败，不给错误数字 |
| UPSTREAM_FAILED | 6027；搜索专用可映射 6015 | 是，有上限 | 上游类别与 traceId |
| OUTPUT_SCHEMA_INVALID | 6029 | 否 | 输出契约失败，不把原始 payload 交给模型 |
| RESULT_TOO_LARGE | 6012 | 否 | 缩小时间范围或字段 |
| CANCELLED | 6031 | 否 | 已取消 |
| INTERNAL_ERROR | 6099 | 仅明确的基础设施瞬时错误 | 只展示 traceId，不显示堆栈/SQL |

公共数字错误码以 [API 错误码](../../api/error-codes.md) 为准；Tool code 是内部稳定分类，Controller 负责映射。未知异常统一 `INTERNAL_ERROR`，原始异常只进入脱敏日志。
