-- Allow historical dividend rows with NULL ann_date.
ALTER TABLE "stock_dividend_events"
ALTER COLUMN "ann_date" DROP NOT NULL;
