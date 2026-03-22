-- Rename Tushare tables to clearer, domain-oriented names.
-- This migration preserves existing data by renaming tables in place.

ALTER TABLE "stock_basic" RENAME TO "stock_basic_profiles";
ALTER TABLE "stock_company" RENAME TO "stock_company_profiles";
ALTER TABLE "trade_cal" RENAME TO "exchange_trade_calendars";
ALTER TABLE "daily" RENAME TO "stock_daily_prices";
ALTER TABLE "weekly" RENAME TO "stock_weekly_prices";
ALTER TABLE "monthly" RENAME TO "stock_monthly_prices";
ALTER TABLE "adj_factor" RENAME TO "stock_adjustment_factors";
ALTER TABLE "daily_basic" RENAME TO "stock_daily_valuation_metrics";
ALTER TABLE "moneyflow_dc" RENAME TO "stock_capital_flows";
ALTER TABLE "moneyflow_ind_dc" RENAME TO "sector_capital_flows";
ALTER TABLE "moneyflow_mkt_dc" RENAME TO "market_capital_flows";
ALTER TABLE "express" RENAME TO "earnings_express_reports";
ALTER TABLE "fina_indicator" RENAME TO "financial_indicator_snapshots";
ALTER TABLE "dividend" RENAME TO "stock_dividend_events";
ALTER TABLE "top10_holders" RENAME TO "top_ten_shareholder_snapshots";
ALTER TABLE "top10_float_holders" RENAME TO "top_ten_float_shareholder_snapshots";
