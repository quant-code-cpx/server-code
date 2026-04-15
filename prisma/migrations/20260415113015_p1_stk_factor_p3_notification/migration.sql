-- ────────────────────────────────────────────────────────────────────────────
-- Migration: p1_stk_factor_p3_notification
-- 1. StkFactor (stock_technical_factors) — 技术因子预计算表
-- 2. NotificationType enum
-- 3. Notification (notifications) — 站内消息通知
-- 4. NotificationPreference (notification_preferences) — 通知偏好设置
-- ────────────────────────────────────────────────────────────────────────────

-- Add STK_FACTOR to TushareSyncTask enum
ALTER TYPE "TushareSyncTask" ADD VALUE IF NOT EXISTS 'STK_FACTOR';

-- Create NotificationType enum
CREATE TYPE "notification_type" AS ENUM (
  'PRICE_ALERT',
  'MARKET_ANOMALY',
  'SCREENER_ALERT',
  'SIGNAL_TRIGGERED',
  'SYSTEM'
);

-- CreateTable: stock_technical_factors
CREATE TABLE "stock_technical_factors" (
    "ts_code"     VARCHAR(16)  NOT NULL,
    "trade_date"  DATE         NOT NULL,
    "close"       DOUBLE PRECISION,
    "open"        DOUBLE PRECISION,
    "high"        DOUBLE PRECISION,
    "low"         DOUBLE PRECISION,
    "pre_close"   DOUBLE PRECISION,
    "change"      DOUBLE PRECISION,
    "pct_chg"     DOUBLE PRECISION,
    "vol"         DOUBLE PRECISION,
    "amount"      DOUBLE PRECISION,
    "macd_dif"    DOUBLE PRECISION,
    "macd_dea"    DOUBLE PRECISION,
    "macd"        DOUBLE PRECISION,
    "kdj_k"       DOUBLE PRECISION,
    "kdj_d"       DOUBLE PRECISION,
    "kdj_j"       DOUBLE PRECISION,
    "rsi_6"       DOUBLE PRECISION,
    "rsi_12"      DOUBLE PRECISION,
    "rsi_24"      DOUBLE PRECISION,
    "boll_upper"  DOUBLE PRECISION,
    "boll_mid"    DOUBLE PRECISION,
    "boll_lower"  DOUBLE PRECISION,
    "cci_14"      DOUBLE PRECISION,
    "cci_20"      DOUBLE PRECISION,
    "tr"          DOUBLE PRECISION,
    "atr14"       DOUBLE PRECISION,
    "atr20"       DOUBLE PRECISION,
    "vr_26"       DOUBLE PRECISION,
    CONSTRAINT "stock_technical_factors_pkey" PRIMARY KEY ("ts_code", "trade_date")
);

CREATE INDEX "stock_technical_factors_trade_date_idx" ON "stock_technical_factors"("trade_date");
CREATE INDEX "stock_technical_factors_ts_code_trade_date_idx" ON "stock_technical_factors"("ts_code", "trade_date" DESC);

-- CreateTable: notifications
CREATE TABLE "notifications" (
    "id"         SERIAL          NOT NULL,
    "user_id"    INTEGER         NOT NULL,
    "type"       "notification_type" NOT NULL,
    "title"      VARCHAR(128)    NOT NULL,
    "body"       VARCHAR(512)    NOT NULL,
    "data"       JSONB           NOT NULL DEFAULT '{}',
    "is_read"    BOOLEAN         NOT NULL DEFAULT false,
    "read_at"    TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at" DESC);
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: notification_preferences
CREATE TABLE "notification_preferences" (
    "id"         SERIAL              NOT NULL,
    "user_id"    INTEGER             NOT NULL,
    "type"       "notification_type" NOT NULL,
    "enabled"    BOOLEAN             NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_preferences_user_id_type_key"
    ON "notification_preferences"("user_id", "type");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
