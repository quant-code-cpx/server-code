from __future__ import annotations

from typing import Protocol

import pandas as pd


class NewsGateway(Protocol):
    def eastmoney_latest(self) -> pd.DataFrame: ...
    def cls_latest(self) -> pd.DataFrame: ...
    def notices_daily(self, date: str) -> pd.DataFrame: ...
    def notices_security(self, security: str, begin_date: str, end_date: str) -> pd.DataFrame: ...


class AkshareGateway:
    def eastmoney_latest(self) -> pd.DataFrame:
        import akshare as ak

        return ak.stock_info_global_em()

    def cls_latest(self) -> pd.DataFrame:
        import akshare as ak

        return ak.stock_info_global_cls(symbol="全部")

    def notices_daily(self, date: str) -> pd.DataFrame:
        import akshare as ak

        return ak.stock_notice_report(symbol="全部", date=date)

    def notices_security(self, security: str, begin_date: str, end_date: str) -> pd.DataFrame:
        import akshare as ak

        return ak.stock_individual_notice_report(
            security=security,
            symbol="全部",
            begin_date=begin_date,
            end_date=end_date,
        )
