-- AlterTable
ALTER TABLE "price_alert_rules" ADD COLUMN     "portfolio_id" TEXT,
ADD COLUMN     "source_name" VARCHAR(100),
ADD COLUMN     "watchlist_id" INTEGER,
ALTER COLUMN "ts_code" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "price_alert_rules_watchlist_id_idx" ON "price_alert_rules"("watchlist_id");

-- CreateIndex
CREATE INDEX "price_alert_rules_portfolio_id_idx" ON "price_alert_rules"("portfolio_id");

-- AddForeignKey
ALTER TABLE "price_alert_rules" ADD CONSTRAINT "price_alert_rules_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "watchlists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_alert_rules" ADD CONSTRAINT "price_alert_rules_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
