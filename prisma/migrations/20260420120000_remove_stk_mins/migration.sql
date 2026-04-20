-- Drop stk_mins table (Tushare stk_mins API requires permission not available)
DROP TABLE IF EXISTS "stk_mins";

-- Remove STK_MINS from TushareSyncTask enum
-- PostgreSQL does not support DROP VALUE; recreate the type instead

-- 1. Clean up any stray rows referencing STK_MINS (should be empty)
DELETE FROM "tushare_sync_logs" WHERE "task" = 'STK_MINS';
DELETE FROM "tushare_sync_progress" WHERE "task" = 'STK_MINS';
DELETE FROM "tushare_sync_retry_queue" WHERE "task" = 'STK_MINS';

-- 2. Create replacement enum without STK_MINS
CREATE TYPE "TushareSyncTask_new" AS ENUM (
  'STOCK_BASIC', 'STOCK_COMPANY', 'TRADE_CAL', 'DAILY', 'WEEKLY', 'MONTHLY',
  'ADJ_FACTOR', 'DAILY_BASIC', 'INDEX_DAILY', 'MONEYFLOW_DC', 'MONEYFLOW_IND_DC',
  'MONEYFLOW_MKT_DC', 'MONEYFLOW_HSGT', 'INCOME', 'BALANCE_SHEET', 'CASHFLOW',
  'EXPRESS', 'FINA_INDICATOR', 'DIVIDEND', 'TOP10_HOLDERS', 'TOP10_FLOAT_HOLDERS',
  'STK_LIMIT', 'SUSPEND_D', 'INDEX_WEIGHT', 'MARGIN_DETAIL', 'TOP_LIST', 'TOP_INST',
  'BLOCK_TRADE', 'SHARE_FLOAT', 'DATA_QUALITY_CHECK', 'FORECAST', 'STK_HOLDER_NUMBER',
  'HK_HOLD', 'INDEX_DAILY_BASIC', 'STK_HOLDER_TRADE', 'PLEDGE_STAT', 'FINA_AUDIT',
  'DISCLOSURE_DATE', 'FINA_MAINBZ', 'INDEX_CLASSIFY', 'INDEX_MEMBER_ALL', 'REPURCHASE',
  'CB_BASIC', 'CB_DAILY', 'THS_INDEX', 'THS_MEMBER',
  'FUND_BASIC', 'FUND_NAV', 'FUND_DAILY',
  'CN_CPI', 'CN_PPI', 'CN_GDP', 'SHIBOR',
  'OPT_BASIC', 'OPT_DAILY',
  'STK_FACTOR',
  'DAILY_INFO', 'LIMIT_LIST_D',
  'FUND_PORTFOLIO', 'FUND_SHARE',
  'CYQ_PERF', 'CYQ_CHIPS',
  'STK_SURV',
  'THS_DAILY',
  'FUND_ADJ',
  'GGT_DAILY'
);

-- 3. Migrate all three columns
ALTER TABLE "tushare_sync_logs"
  ALTER COLUMN "task" TYPE "TushareSyncTask_new"
  USING "task"::text::"TushareSyncTask_new";

ALTER TABLE "tushare_sync_progress"
  ALTER COLUMN "task" TYPE "TushareSyncTask_new"
  USING "task"::text::"TushareSyncTask_new";

ALTER TABLE "tushare_sync_retry_queue"
  ALTER COLUMN "task" TYPE "TushareSyncTask_new"
  USING "task"::text::"TushareSyncTask_new";

-- 4. Swap types
DROP TYPE "TushareSyncTask";
ALTER TYPE "TushareSyncTask_new" RENAME TO "TushareSyncTask";
