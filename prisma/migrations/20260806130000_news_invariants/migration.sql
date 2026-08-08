ALTER TABLE "news_articles"
  ADD CONSTRAINT "news_articles_revision_positive_check"
    CHECK ("current_revision" >= 1),
  ADD CONSTRAINT "news_articles_published_precision_check"
    CHECK (
      ("published_precision" = 'SECOND' AND "published_at" IS NOT NULL AND "published_date" IS NULL)
      OR
      ("published_precision" = 'MINUTE' AND "published_at" IS NOT NULL AND "published_date" IS NULL
        AND date_trunc('minute', "published_at") = "published_at")
      OR
      ("published_precision" = 'DATE' AND "published_at" IS NULL AND "published_date" IS NOT NULL)
      OR
      ("published_precision" = 'UNKNOWN' AND "published_at" IS NULL AND "published_date" IS NULL)
    );

ALTER TABLE "news_article_revisions"
  ADD CONSTRAINT "news_article_revisions_revision_positive_check"
    CHECK ("revision" >= 1),
  ADD CONSTRAINT "news_article_revisions_published_precision_check"
    CHECK (
      ("published_precision" = 'SECOND' AND "published_at" IS NOT NULL AND "published_date" IS NULL)
      OR
      ("published_precision" = 'MINUTE' AND "published_at" IS NOT NULL AND "published_date" IS NULL
        AND date_trunc('minute', "published_at") = "published_at")
      OR
      ("published_precision" = 'DATE' AND "published_at" IS NULL AND "published_date" IS NOT NULL)
      OR
      ("published_precision" = 'UNKNOWN' AND "published_at" IS NULL AND "published_date" IS NULL)
    );

ALTER TABLE "news_security_links"
  ADD CONSTRAINT "news_security_links_confidence_check"
    CHECK ("confidence" >= 0 AND "confidence" <= 1);

ALTER TABLE "news_ingestion_cursors"
  ADD CONSTRAINT "news_ingestion_cursors_counters_check"
    CHECK ("version" >= 1 AND "consecutive_failures" >= 0);

ALTER TABLE "news_feed_health"
  ADD CONSTRAINT "news_feed_health_failures_check"
    CHECK ("consecutive_failures" >= 0);

ALTER TABLE "news_ingestion_runs"
  ADD CONSTRAINT "news_ingestion_runs_counts_nonnegative_check"
    CHECK (
      "fetched_count" >= 0
      AND "inserted_count" >= 0
      AND "revised_count" >= 0
      AND "duplicate_count" >= 0
      AND "quarantined_count" >= 0
    ),
  ADD CONSTRAINT "news_ingestion_runs_counts_balance_check"
    CHECK (
      "fetched_count" = "inserted_count" + "revised_count" + "duplicate_count" + "quarantined_count"
    );
