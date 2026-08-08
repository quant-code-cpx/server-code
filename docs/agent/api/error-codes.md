# Agent 错误码

在 `src/constant/response-code.constant.ts` 的 `ErrorEnum` 增加 6001–6099；HTTP 状态表达传输语义，`code` 表达业务原因。

| code | 枚举建议                          | HTTP | 用户可重试 | 含义                                           |
| ---: | --------------------------------- | ---: | ---------- | ---------------------------------------------- |
| 6001 | `AI_CONVERSATION_NOT_FOUND`       |  404 | 否         | 会话不存在或不属于当前用户                     |
| 6002 | `AI_RUN_NOT_FOUND`                |  404 | 否         | Run 不存在或不属于当前用户                     |
| 6003 | `AI_RUN_NOT_CANCELLABLE`          |  409 | 否         | Run 已终态或状态版本冲突                       |
| 6004 | `AI_DUPLICATE_REQUEST_CONFLICT`   |  409 | 否         | 同一幂等键携带不同请求内容                     |
| 6005 | `AI_MODEL_NOT_AVAILABLE`          |  503 | 是         | 模型不可用且降级失败                           |
| 6006 | `AI_MODEL_RATE_LIMITED`           |  429 | 是         | 供应商限流                                     |
| 6007 | `AI_MODEL_TIMEOUT`                |  504 | 是         | 模型调用超时                                   |
| 6008 | `AI_TOOL_NOT_FOUND`               |  400 | 否         | Workflow 引用了未注册 Tool                     |
| 6009 | `AI_TOOL_FORBIDDEN`               |  403 | 否         | 用户、角色或数据域无权限                       |
| 6010 | `AI_TOOL_VALIDATION_FAILED`       |  400 | 否         | Tool 参数不符合 JSON Schema                    |
| 6011 | `AI_TOOL_TIMEOUT`                 |  504 | 是         | Tool 超时                                      |
| 6012 | `AI_TOOL_RESULT_LIMIT_EXCEEDED`   |  422 | 否         | 时间范围/行数超限                              |
| 6013 | `AI_DATA_NOT_AVAILABLE`           |  422 | 否         | 截止日内没有可用数据                           |
| 6014 | `AI_DATA_STALE`                   |  409 | 否         | 数据时效不满足任务要求                         |
| 6015 | `AI_SEARCH_FAILED`                |  502 | 是         | 搜索供应商均失败                               |
| 6016 | `AI_WEB_SOURCE_BLOCKED`           |  422 | 否         | SSRF、恶意内容、付费墙或 robots 策略拦截       |
| 6017 | `AI_CITATION_INVALID`             |  422 | 否         | 引用无法验证，不允许生成事实性结论             |
| 6018 | `AI_RUN_INPUT_TOKEN_GUARDRAIL_EXCEEDED` | 422 | 否 | 显式 Run 累计输入成本护栏将在下一次模型调用前超限 |
| 6019 | `AI_COST_QUOTA_EXCEEDED`          |  429 | 否         | 用户单次/每日成本配额不足                      |
| 6020 | `AI_RUN_TIMEOUT`                  |  504 | 是         | Run 总时限到达                                 |
| 6021 | `AI_SCHEDULE_INVALID`             |  400 | 否         | Cron/时区/交易日规则无效                       |
| 6022 | `AI_NOTIFICATION_CHANNEL_INVALID` |  400 | 否         | 通知通道配置不完整                             |
| 6023 | `AI_NOTIFICATION_DELIVERY_FAILED` |  502 | 是         | 通知发送失败                                   |
| 6024 | `AI_WORKFLOW_VERSION_MISSING`     |  409 | 否         | 任务固定的工作流版本不存在                     |
| 6025 | `AI_PROMPT_VERSION_MISSING`       |  409 | 否         | Prompt 版本不存在                              |
| 6026 | `AI_TOOL_RATE_LIMITED`            |  429 | 是         | Tool 的外部依赖或专属额度限流                  |
| 6027 | `AI_TOOL_UPSTREAM_FAILED`         |  502 | 是         | Tool 依赖的内部/外部服务失败                   |
| 6028 | `AI_DATA_QUALITY_FAILED`          |  422 | 否         | 单位、完整性或点时性门禁失败，禁止返回事实数字 |
| 6029 | `AI_TOOL_OUTPUT_INVALID`          |  502 | 否         | Tool 输出不符合已发布 Schema                   |
| 6030 | `AI_CONFIRMATION_REQUIRED`        |  409 | 否         | 受控写操作尚未取得用户明确确认                 |
| 6031 | `AI_RUN_CANCELLED`                |  409 | 否         | 操作因 Run 已取消而终止                        |
| 6032 | `AI_MEMORY_NOT_FOUND`             |  404 | 否         | 记忆不存在或不属于当前用户                     |
| 6033 | `AI_MEMORY_VALIDATION_FAILED`     |  400 | 否         | 记忆参数、来源、内容容量或敏感策略校验失败     |
| 6034 | `AI_MEMORY_CONFLICT`              |  409 | 否         | active key、状态或版本并发冲突                 |
| 6035 | `AI_SUMMARY_VERSION_CONFLICT`     |  409 | 是         | 会话摘要 expected version 已推进，需重读后重试 |
| 6036 | `AI_SUMMARY_VALIDATION_FAILED`    |  422 | 否         | 摘要内容、来源范围或 Prompt 版本校验失败       |
| 6037 | `AI_SCHEDULE_NOT_FOUND`           |  404 | 否         | 定时研究任务不存在或不属于当前用户             |
| 6038 | `AI_SCHEDULE_CONFLICT`            |  409 | 是         | 任务 CAS 版本、状态或幂等请求内容发生冲突      |
| 6039 | `AI_NOTIFICATION_CHANNEL_NOT_FOUND` | 404 | 否 | 通知渠道不存在或不属于当前用户 |
| 6040 | `AI_NOTIFICATION_DELIVERY_NOT_FOUND` | 404 | 否 | 通知投递不存在或不属于当前用户 |
| 6041 | `AI_NOTIFICATION_DELIVERY_CONFLICT` | 409 | 否 | 通知投递当前状态不允许重试 |
| 6042 | `AI_NOTIFICATION_CHANNEL_CONFLICT` | 409 | 否 | 通知渠道 CAS 版本或状态冲突 |
| 6043 | `AI_RESEARCH_REPORT_NOT_FOUND` | 404 | 否 | 研究报告不存在或无权访问 |
| 6044 | `AI_RESEARCH_REPORT_INVALID` | 400 | 否 | 报告参数、来源 Run、投资日志或内容协议无效 |
| 6045 | `AI_RESEARCH_REPORT_CONFIRMATION_INVALID` | 409 | 否 | 确认 token 已过期、被篡改或绑定内容已变化 |
| 6046 | `AI_RESEARCH_REPORT_CONFLICT` | 409 | 否 | 幂等请求复用不同报告内容或版本/删除并发冲突 |
| 6047 | `AI_CONTEXT_COMPACTION_FAILED` | 503 | 是 | 必须压缩历史，但摘要生成、校验或提交失败 |
| 6048 | `AI_MODEL_CONTEXT_INCOMPATIBLE` | 422 | 否 | 目标模型窗口无法满足安全输入/输出预算 |
| 6049 | `AI_CURRENT_INPUT_TOO_LARGE` | 422 | 否 | 当前用户输入本身超过目标模型输入预算 |
| 6099 | `AI_INTERNAL_ERROR`               |  500 | 是         | 未分类内部错误；只向用户返回 traceId           |

Tool 内部错误使用稳定字符串，完整映射见 [Tool 错误 Schema](../tools/schemas/tool-errors.md)。这些值进入 Tool 审计和受控模型上下文，但 API 出口只映射到上表数字码。

安全规则：生产环境不得把供应商原始响应、SQL、网页正文、堆栈、密钥或持仓数据放进 `message`；只在受控日志中记录脱敏 `traceId` 和内部错误分类。
