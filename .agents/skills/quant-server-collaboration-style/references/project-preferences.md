# 项目偏好清单

## 协作方式

- 优先由代理直接完成终端验证步骤，而不是把常规操作交给用户手动执行。
- 修改尽量小步推进，每完成一个有意义的步骤就验证一次。
- 调试时偏好看真实日志与运行行为，不喜欢只靠猜测。
- 只要代理能继续推进，就尽量减少来回确认式对话。

## 统一响应格式

- 项目统一使用 `src/common/models/response.model.ts` 中的 `ResponseModel` 封装响应。
- **`TransformInterceptor`（全局注册）会自动将控制器返回的原始数据包装为 `ResponseModel.success({ data })`**，因此大多数控制器方法只需返回原始数据即可，无需手动构造 `ResponseModel`。
- **`data` 字段**：存放业务数据对象。
- **`message` 字段**：存放状态说明/人类可读提示。若接口只需返回提示无实际数据，应在控制器中显式返回 `ResponseModel.success({ message: '...' })`，此时 `data` 为 `undefined`。不要把纯提示信息放在 `data.message` 里。
- **Swagger 标注规范**：
  - 有具体数据返回：使用 `@ApiSuccessResponse(SomeDtoClass)` 或 `@ApiSuccessResponse(SomeDtoClass, { isArray: true })`。
  - 无数据只有提示/操作确认：使用 `@ApiSuccessRawResponse({ type: 'null', nullable: true })`。
- **错误响应**：由 `GlobalExceptionsFilter` 统一处理，调用 `ResponseModel.error({ code, message })`，控制器无需干预。
- 避免在 `data` 字段里放只属于 `message` 字段的内容，也避免创建只有 `message` 属性的冗余 DTO。

## 基础设施

- 首次启动时应尽量自动准备数据库结构。
- 本机相关路径和密钥放在 `.env`。
- 不要把个人绝对路径提交到 Compose 或其他共享配置文件中。
- 涉及容器的改动要通过真实服务日志验证。

## Prisma 与数据建模

- Prisma schema 应反映上游真实数据，而不是沿用旧代码假设。
- 如果 API 返回和 schema 不一致，应同时更新 schema 与 mapper。
- migration 要明确、可验证。

## Tushare 集成

- 官方文档是意图来源。
- 真实 API 返回是字段形态的事实来源。
- 正式同步应保留全量逻辑，不要为了省事做人为限量。
- 当前账户限制下，要围绕 2000 积分档频控来设计节流和重试。
- 临时 debug 接口可以用于排查，但验证完成后不应继续挂在正式模块里。

## 架构方向

- `TushareSyncService` 应保持为 orchestrator，而不是巨型实现文件。
- 同步逻辑按领域拆分，文件变大后继续按子领域细拆。
- 顶层编排优先使用 `getSyncPlan()` 这类 plan-driven 方式，而不是持续在总控里硬编码任务列表。
- 公共同步辅助逻辑集中在 support service。

## 输出要求

- 总结要明确写出改了什么、如何验证的。
- 要主动说明频控、环境变量、迁移、启动方式等运行注意事项。
- 偏好可维护、面向生产的方案，而不是临时补丁。
