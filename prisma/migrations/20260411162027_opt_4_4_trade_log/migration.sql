-- CreateTable
CREATE TABLE "portfolio_trade_log" (
    "id" UUID NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "ts_code" VARCHAR(20) NOT NULL,
    "stock_name" VARCHAR(60),
    "action" VARCHAR(16) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION,
    "reason" VARCHAR(32) NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_trade_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_trade_log_portfolio_id_created_at_idx" ON "portfolio_trade_log"("portfolio_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "portfolio_trade_log_user_id_created_at_idx" ON "portfolio_trade_log"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "portfolio_trade_log_ts_code_idx" ON "portfolio_trade_log"("ts_code");

-- AddForeignKey
ALTER TABLE "portfolio_trade_log" ADD CONSTRAINT "portfolio_trade_log_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
