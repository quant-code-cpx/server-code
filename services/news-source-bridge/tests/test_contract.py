from __future__ import annotations

import pandas as pd
from fastapi.testclient import TestClient

from app.main import create_app

TOKEN = "bridge-test-token-that-is-at-least-32-bytes"


class FakeGateway:
    eastmoney = pd.DataFrame()
    cls = pd.DataFrame()
    daily = pd.DataFrame()
    security = pd.DataFrame()
    calls: list[tuple] = []

    def eastmoney_latest(self) -> pd.DataFrame:
        self.calls.append(("eastmoney",))
        return self.eastmoney

    def cls_latest(self) -> pd.DataFrame:
        self.calls.append(("cls", "全部"))
        return self.cls

    def notices_daily(self, date: str) -> pd.DataFrame:
        self.calls.append(("daily", date, "全部"))
        return self.daily

    def notices_security(self, security: str, begin_date: str, end_date: str) -> pd.DataFrame:
        self.calls.append(("security", security, begin_date, end_date))
        return self.security


def client(gateway: FakeGateway | None = None) -> tuple[TestClient, FakeGateway]:
    fake = gateway or FakeGateway()
    fake.calls = []
    return TestClient(create_app(fake, TOKEN)), fake


def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {TOKEN}"}


def test_news_edge_001_all_four_endpoints_accept_empty_frames() -> None:
    api, gateway = client()
    cases = [
        ("/v1/feeds/eastmoney/latest", {}),
        ("/v1/feeds/cls/latest", {"scope": "ALL"}),
        ("/v1/notices/daily", {"date": "20260806"}),
        ("/v1/notices/security/range", {"security": "600519", "beginDate": "20260707", "endDate": "20260806"}),
    ]
    for path, body in cases:
        response = api.post(path, headers=auth(), json=body)
        assert response.status_code == 200
        assert response.json()["schemaVersion"] == 1
        assert response.json()["items"] == []
        assert response.json()["warnings"] == []
    assert [call[0] for call in gateway.calls] == ["eastmoney", "cls", "daily", "security"]


def test_news_biz_001_eastmoney_mapping_preserves_shanghai_time() -> None:
    gateway = FakeGateway()
    gateway.eastmoney = pd.DataFrame(
        [{"标题": "东财新闻", "摘要": "摘要", "发布时间": "2026-08-06 12:01:02", "链接": "https://example.com/a"}]
    )
    api, _ = client(gateway)
    response = api.post("/v1/feeds/eastmoney/latest", headers=auth(), json={})
    item = response.json()["items"][0]
    assert response.status_code == 200
    assert item["contentType"] == "NEWS"
    assert item["publishedAt"] == "2026-08-06T12:01:02.000+08:00"
    assert item["publishedPrecision"] == "SECOND"
    assert len(item["rawPayloadHash"]) == 64


def test_news_biz_002_cls_without_url_is_valid() -> None:
    gateway = FakeGateway()
    gateway.cls = pd.DataFrame([{"标题": "", "内容": "快讯正文", "发布日期": "2026-08-06", "发布时间": "12:01"}])
    api, _ = client(gateway)
    response = api.post("/v1/feeds/cls/latest", headers=auth(), json={"scope": "ALL"})
    item = response.json()["items"][0]
    assert response.status_code == 200
    assert item["contentType"] == "FLASH"
    assert item["canonicalUrl"] is None
    assert item["title"] == ""
    assert item["excerpt"] == "快讯正文"


def test_news_biz_003_notice_mapping_keeps_date_precision_and_security_hint() -> None:
    gateway = FakeGateway()
    gateway.daily = pd.DataFrame(
        [{"代码": "600519", "名称": "贵州茅台", "公告标题": "年度报告", "公告类型": "定期报告", "公告日期": "2026-08-06", "网址": "https://example.com/n"}]
    )
    api, _ = client(gateway)
    response = api.post("/v1/notices/daily", headers=auth(), json={"date": "20260806"})
    item = response.json()["items"][0]
    assert item["contentType"] == "NOTICE"
    assert item["publishedAt"] is None
    assert item["publishedDate"] == "2026-08-06"
    assert item["publishedPrecision"] == "DATE"
    assert item["securityHints"] == ["600519"]
    assert item["qualityFlags"] == ["POSSIBLE_SECURITY_OMISSION"]


def test_news_err_bridge_auth_extra_fields_and_31_day_limit() -> None:
    api, gateway = client()
    unauthorized = api.post("/v1/feeds/eastmoney/latest", json={})
    assert unauthorized.status_code == 401
    assert unauthorized.json() == {
        "code": "INVALID_ARGUMENT",
        "retryable": False,
        "message": "未授权访问",
        "requestId": unauthorized.json()["requestId"],
    }
    assert api.post("/v1/feeds/eastmoney/latest", headers=auth(), json={"function": "eval"}).status_code == 422
    too_long = api.post(
        "/v1/notices/security/range",
        headers=auth(),
        json={"security": "600519", "beginDate": "20260706", "endDate": "20260806"},
    )
    assert too_long.status_code == 422
    assert gateway.calls == []
