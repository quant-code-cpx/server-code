-- 将 TushareSyncTask 枚举值 MONEYFLOW_DC 重命名为 MONEYFLOW
-- moneyflow 接口为 Tushare 自有个股资金流向数据，与东财无关，去掉 _DC 后缀避免误导

ALTER TYPE "TushareSyncTask" RENAME VALUE 'MONEYFLOW_DC' TO 'MONEYFLOW';
