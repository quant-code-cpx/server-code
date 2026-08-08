-- Snapshot-aware keyword search only scans the small post-snapshot drift branch.
CREATE INDEX "news_articles_updated_at_idx" ON "news_articles"("updated_at");
