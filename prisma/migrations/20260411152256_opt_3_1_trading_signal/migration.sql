-- CreateTable
CREATE TABLE "trading_signals" (
    "id" TEXT NOT NULL,
    "activation_id" TEXT NOT NULL,
    "strategy_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "trade_date" DATE NOT NULL,
    "ts_code" VARCHAR(15) NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "target_weight" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trading_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signal_activations" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "strategy_id" TEXT NOT NULL,
    "portfolio_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "universe" VARCHAR(32) NOT NULL DEFAULT 'ALL_A',
    "benchmark_ts_code" VARCHAR(16) NOT NULL DEFAULT '000300.SH',
    "lookback_days" INTEGER NOT NULL DEFAULT 250,
    "alert_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "last_signal_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signal_activations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trading_signals_user_id_trade_date_idx" ON "trading_signals"("user_id", "trade_date" DESC);

-- CreateIndex
CREATE INDEX "trading_signals_strategy_id_trade_date_idx" ON "trading_signals"("strategy_id", "trade_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "trading_signals_activation_id_trade_date_ts_code_key" ON "trading_signals"("activation_id", "trade_date", "ts_code");

-- CreateIndex
CREATE INDEX "signal_activations_is_active_idx" ON "signal_activations"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "signal_activations_user_id_strategy_id_key" ON "signal_activations"("user_id", "strategy_id");
