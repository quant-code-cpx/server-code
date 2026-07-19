-- Dividend natural business key:
-- security + reporting/announcement dates + process stage + scheme fields.
-- Implementation dates are deliberately excluded because Tushare may fill them
-- later for the same scheme. NULLS NOT DISTINCT is required because historical
-- ann_date is often null; a normal PostgreSQL unique index would still allow
-- unlimited duplicates for those rows.

LOCK TABLE "stock_dividend_events" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    deleted_count BIGINT;
BEGIN
    WITH ranked AS (
        SELECT
            "id",
            ROW_NUMBER() OVER (
                PARTITION BY
                    "ts_code",
                    "end_date",
                    "ann_date",
                    "div_proc",
                    "stk_div",
                    "stk_bo_rate",
                    "stk_co_rate",
                    "cash_div",
                    "cash_div_tax"
                ORDER BY "synced_at" DESC, "id" DESC
            ) AS duplicate_rank
        FROM "stock_dividend_events"
    )
    DELETE FROM "stock_dividend_events" AS dividend
    USING ranked
    WHERE dividend."id" = ranked."id"
      AND ranked.duplicate_rank > 1;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Removed % duplicate stock_dividend_events rows', deleted_count;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "stock_dividend_events_business_key"
    ON "stock_dividend_events" (
        "ts_code",
        "end_date",
        "ann_date",
        "div_proc",
        "stk_div",
        "stk_bo_rate",
        "stk_co_rate",
        "cash_div",
        "cash_div_tax"
    ) NULLS NOT DISTINCT;
