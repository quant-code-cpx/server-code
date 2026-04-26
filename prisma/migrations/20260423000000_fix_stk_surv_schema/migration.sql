-- stk_surv 表结构修正：原表字段基于错误的「技术面因子」概念
-- 实际 stk_surv API 返回的是「机构调研」数据，字段完全不同
-- 旧表为空（0 rows），直接重建

DROP TABLE IF EXISTS "stk_surv";

CREATE TABLE "stk_surv" (
  "ts_code"       VARCHAR(16)   NOT NULL,
  "surv_date"     DATE          NOT NULL,
  "name"          VARCHAR(64),
  "fund_visitors" VARCHAR(256),
  "rece_place"    VARCHAR(256),
  "rece_mode"     VARCHAR(256),
  "rece_org"      VARCHAR(256),
  "org_type"      VARCHAR(64),
  "comp_rece"     VARCHAR(512),
  "synced_at"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stk_surv_pkey" PRIMARY KEY ("ts_code", "surv_date")
);

CREATE INDEX "stk_surv_surv_date_idx"         ON "stk_surv" ("surv_date");
CREATE INDEX "stk_surv_ts_code_surv_date_idx" ON "stk_surv" ("ts_code", "surv_date" DESC);
