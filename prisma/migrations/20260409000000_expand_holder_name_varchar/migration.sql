-- AlterTable: expand holder_name from VARCHAR(128) to VARCHAR(512)
-- Some Tushare records contain holder names longer than 128 characters.
ALTER TABLE "stock_holder_trades" ALTER COLUMN "holder_name" TYPE VARCHAR(512);
