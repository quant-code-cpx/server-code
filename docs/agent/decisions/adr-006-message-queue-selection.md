# ADR-006：消息队列选择

## 背景

项目已使用 `@nestjs/bullmq`、BullMQ 5 和 Redis，存在回测、条件订阅、事件研究队列；Cron 也已使用。

## 问题

Agent 长任务、定时任务、抓取和通知使用 BullMQ、其他 MQ，还是进程内 Promise？

## 可选方案

1. 进程内异步。
2. 复用 BullMQ/Redis。
3. RabbitMQ/Kafka。
4. Temporal 等独立工作流平台。

## 最终决策

复用 BullMQ；新增 `agent-execution` 与 `agent-notification` 队列。所有 Run 入队，同一代码库可分别启动 API、Worker、Scheduler。数据库保存权威状态，BullMQ 只负责投递/重试，不作为永久审计源。

## 选择理由

现有依赖、连接和运维经验可复用；支持重试、延迟、重复任务和取消；当前吞吐不需要 Kafka。

## 放弃其他方案原因

进程内任务重启丢失；引入新 MQ/Temporal 增加部署面；Kafka 不适合当前命令任务语义。

## 正面影响

长任务可靠、横向扩 Worker、定时触发统一。

## 负面影响

Redis 故障影响任务；数据库状态与队列需一致性补偿。

## 风险

重复执行和“入库成功但入队失败”。使用事务 Outbox/补偿扫描、确定性 jobId、步骤幂等键和分布式锁。

## 后续复审条件

需要跨区域事件流、吞吐超过 Redis 能力、任务编排跨多个组织系统，或 BullMQ 恢复指标不达标。
