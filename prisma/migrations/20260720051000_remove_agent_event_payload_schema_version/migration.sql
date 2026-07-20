-- schemaVersion 属于公共 Agent Event 顶层，不属于各事件 payload。
-- Batch 005 曾把该键写入 payload；SSE 上线前清理，恢复严格 payload schema。
ALTER TABLE "ai_run_events" DISABLE TRIGGER "ai_run_events_integrity_trigger";

UPDATE "ai_run_events"
SET "payload" = "payload" - 'schemaVersion'
WHERE "payload" ? 'schemaVersion';

ALTER TABLE "ai_run_events" ENABLE TRIGGER "ai_run_events_integrity_trigger";
