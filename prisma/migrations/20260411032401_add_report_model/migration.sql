-- CreateEnum
CREATE TYPE "report_type" AS ENUM ('BACKTEST', 'STOCK', 'PORTFOLIO');

-- CreateEnum
CREATE TYPE "report_format" AS ENUM ('JSON', 'HTML', 'PDF');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "report_type" "report_type" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "params" JSONB NOT NULL,
    "data" JSONB,
    "file_path" VARCHAR(500),
    "format" "report_format" NOT NULL DEFAULT 'JSON',
    "status" "report_status" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "file_size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_user_id_created_at_idx" ON "reports"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reports_report_type_idx" ON "reports"("report_type");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
