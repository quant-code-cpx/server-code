-- AlterTable
ALTER TABLE "backtest_runs" ADD COLUMN     "sweep_id" TEXT,
ADD COLUMN     "sweep_x_idx" INTEGER,
ADD COLUMN     "sweep_y_idx" INTEGER;

-- CreateTable
CREATE TABLE "param_sweeps" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "base_run_id" TEXT NOT NULL,
    "param_x_key" VARCHAR(64) NOT NULL,
    "param_x_label" VARCHAR(64),
    "param_x_values" JSONB NOT NULL,
    "param_y_key" VARCHAR(64) NOT NULL,
    "param_y_label" VARCHAR(64),
    "param_y_values" JSONB NOT NULL,
    "metric" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "total_count" INTEGER NOT NULL,
    "completed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "param_sweeps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_versions" (
    "id" TEXT NOT NULL,
    "strategy_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "strategy_config" JSONB NOT NULL,
    "backtest_defaults" JSONB,
    "changelog" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "param_sweeps_user_id_created_at_idx" ON "param_sweeps"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "param_sweeps_base_run_id_idx" ON "param_sweeps"("base_run_id");

-- CreateIndex
CREATE INDEX "strategy_versions_strategy_id_version_idx" ON "strategy_versions"("strategy_id", "version" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "strategy_versions_strategy_id_version_key" ON "strategy_versions"("strategy_id", "version");
