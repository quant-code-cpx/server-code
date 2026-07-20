-- SSE 上线前移除不属于公共事件协议的 run.cancel_requested 内部事件，
-- 并压实受影响 Run 的 sequence，避免客户端把隐藏事件识别为永久 gap。
CREATE TEMP TABLE "_agent_runs_with_hidden_cancel_event" ON COMMIT DROP AS
SELECT DISTINCT "run_id"
FROM "ai_run_events"
WHERE "event_type" = 'run.cancel_requested'
  AND "visibility" = 'INTERNAL';

ALTER TABLE "ai_run_events" DISABLE TRIGGER "ai_run_events_integrity_trigger";

WITH maximums AS (
  SELECT "run_id", max("sequence") AS "maximum_sequence"
  FROM "ai_run_events"
  WHERE "run_id" IN (SELECT "run_id" FROM "_agent_runs_with_hidden_cancel_event")
  GROUP BY "run_id"
)
UPDATE "ai_run_events" AS event
SET "sequence" = event."sequence" + maximums."maximum_sequence"
FROM maximums
WHERE event."run_id" = maximums."run_id";

DELETE FROM "ai_run_events"
WHERE "event_type" = 'run.cancel_requested'
  AND "visibility" = 'INTERNAL';

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (PARTITION BY "run_id" ORDER BY "sequence" ASC) AS "new_sequence"
  FROM "ai_run_events"
  WHERE "run_id" IN (SELECT "run_id" FROM "_agent_runs_with_hidden_cancel_event")
)
UPDATE "ai_run_events" AS event
SET "sequence" = ranked."new_sequence"
FROM ranked
WHERE event."id" = ranked."id";

ALTER TABLE "ai_agent_runs" DISABLE TRIGGER "ai_agent_runs_status_transition_trigger";

UPDATE "ai_agent_runs" AS run
SET "next_event_sequence" = counts."event_count" + 1
FROM (
  SELECT target."run_id", count(event."id")::bigint AS "event_count"
  FROM "_agent_runs_with_hidden_cancel_event" AS target
  LEFT JOIN "ai_run_events" AS event ON event."run_id" = target."run_id"
  GROUP BY target."run_id"
) AS counts
WHERE run."id" = counts."run_id";

ALTER TABLE "ai_agent_runs" ENABLE TRIGGER "ai_agent_runs_status_transition_trigger";
ALTER TABLE "ai_run_events" ENABLE TRIGGER "ai_run_events_integrity_trigger";
