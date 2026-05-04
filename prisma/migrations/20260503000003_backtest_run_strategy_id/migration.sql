-- Add strategy_id to backtest_runs for linking runs back to Strategy records
ALTER TABLE "backtest_runs" ADD COLUMN "strategy_id" VARCHAR(36);
CREATE INDEX "backtest_runs_strategy_id_idx" ON "backtest_runs"("strategy_id");
