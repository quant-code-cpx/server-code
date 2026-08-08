from __future__ import annotations

import sys
from types import ModuleType
from unittest.mock import Mock

import pandas as pd

from app.gateway import AkshareGateway


def test_notices_security_delegates_to_akshare_with_security_filter(monkeypatch) -> None:
    """股票公告区间查询必须按 AKShare 的 security 参数过滤股票。"""
    upstream_result = pd.DataFrame([{"代码": "600519", "公告标题": "年度报告"}])
    stock_individual_notice_report = Mock(return_value=upstream_result)
    fake_akshare = ModuleType("akshare")
    fake_akshare.stock_individual_notice_report = stock_individual_notice_report  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "akshare", fake_akshare)

    result = AkshareGateway().notices_security(
        security="600519",
        begin_date="20260707",
        end_date="20260806",
    )

    stock_individual_notice_report.assert_called_once_with(
        security="600519",
        symbol="全部",
        begin_date="20260707",
        end_date="20260806",
    )
    assert result is upstream_result
