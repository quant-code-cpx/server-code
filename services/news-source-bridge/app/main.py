from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import uuid
from datetime import date, datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

import pandas as pd
from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .gateway import AkshareGateway, NewsGateway

SHANGHAI = ZoneInfo("Asia/Shanghai")
UPSTREAM_TIMEOUT_SECONDS = 45


class EmptyBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ClsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: str

    @field_validator("scope")
    @classmethod
    def validate_scope(cls, value: str) -> str:
        if value != "ALL":
            raise ValueError("scope 只能是 ALL")
        return value


class DailyNoticeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: str = Field(pattern=r"^\d{8}$")

    @field_validator("date")
    @classmethod
    def validate_date(cls, value: str) -> str:
        parse_compact_date(value)
        return value


class SecurityNoticeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    security: str = Field(pattern=r"^\d{6}$")
    beginDate: str = Field(pattern=r"^\d{8}$")
    endDate: str = Field(pattern=r"^\d{8}$")

    @field_validator("endDate")
    @classmethod
    def validate_range(cls, end_date: str, info: Any) -> str:
        begin_raw = info.data.get("beginDate")
        if begin_raw:
            begin = parse_compact_date(begin_raw)
            end = parse_compact_date(end_date)
            if end < begin or (end - begin).days > 30:
                raise ValueError("日期必须递增且最多 31 个日历日")
        return end_date


class BridgeError(Exception):
    def __init__(self, code: str, retryable: bool, message: str, status: int = 502):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.public_message = message
        self.status = status


def create_app(gateway: NewsGateway | None = None, token: str | None = None) -> FastAPI:
    application = FastAPI(title="News Source Bridge", version="1.0.0", docs_url=None, redoc_url=None)
    application.state.gateway = gateway or AkshareGateway()
    application.state.token = token if token is not None else os.environ.get("NEWS_AKSHARE_BRIDGE_TOKEN", "")

    async def authorize(authorization: str | None = Header(default=None)) -> None:
        expected = application.state.token
        supplied = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else ""
        if len(expected.encode("utf-8")) < 32:
            raise BridgeError("INTERNAL_ERROR", False, "Bridge 认证配置无效", 503)
        if not supplied or not hmac.compare_digest(supplied, expected):
            raise BridgeError("INVALID_ARGUMENT", False, "未授权访问", 401)

    @application.exception_handler(BridgeError)
    async def bridge_error_handler(request: Request, error: BridgeError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status,
            content=error_payload(request, error.code, error.retryable, error.public_message),
        )

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, _: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error_payload(request, "INVALID_ARGUMENT", False, "请求参数不符合固定契约"),
        )

    @application.get("/healthz", include_in_schema=False)
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @application.post("/v1/feeds/eastmoney/latest", dependencies=[Depends(authorize)])
    async def eastmoney(body: EmptyBody, request: Request) -> dict[str, Any]:
        frame = await call_upstream(application.state.gateway.eastmoney_latest)
        return envelope(request, [map_eastmoney(row) for row in records(frame)])

    @application.post("/v1/feeds/cls/latest", dependencies=[Depends(authorize)])
    async def cls(body: ClsBody, request: Request) -> dict[str, Any]:
        frame = await call_upstream(application.state.gateway.cls_latest)
        return envelope(request, [map_cls(row) for row in records(frame)])

    @application.post("/v1/notices/daily", dependencies=[Depends(authorize)])
    async def notices_daily(body: DailyNoticeBody, request: Request) -> dict[str, Any]:
        frame = await call_upstream(lambda: application.state.gateway.notices_daily(body.date))
        return envelope(request, [map_notice(row) for row in records(frame)])

    @application.post("/v1/notices/security/range", dependencies=[Depends(authorize)])
    async def notices_security(body: SecurityNoticeBody, request: Request) -> dict[str, Any]:
        frame = await call_upstream(
            lambda: application.state.gateway.notices_security(body.security, body.beginDate, body.endDate)
        )
        return envelope(request, [map_notice(row) for row in records(frame)])

    return application


async def call_upstream(call: Callable[[], pd.DataFrame]) -> pd.DataFrame:
    try:
        result = await asyncio.wait_for(asyncio.to_thread(call), timeout=UPSTREAM_TIMEOUT_SECONDS)
    except TimeoutError as error:
        raise BridgeError("UPSTREAM_TIMEOUT", True, "上游请求超时", 504) from error
    except Exception as error:
        status = getattr(getattr(error, "response", None), "status_code", None)
        if status == 429:
            raise BridgeError("UPSTREAM_RATE_LIMITED", True, "上游请求频率受限", 429) from error
        raise BridgeError("UPSTREAM_UNAVAILABLE", True, "上游新闻源暂时不可用", 502) from error
    if not isinstance(result, pd.DataFrame):
        raise BridgeError("UPSTREAM_SCHEMA_CHANGED", False, "上游返回类型变化", 502)
    return result


def records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    return [{str(key): clean(value) for key, value in row.items()} for row in frame.to_dict(orient="records")]


def map_eastmoney(row: dict[str, Any]) -> dict[str, Any]:
    title = text(row, "标题", "title")
    published = parse_shanghai_datetime(first(row, "发布时间", "时间", "日期"))
    url = optional_text(row, "链接", "网址", "url")
    return item(
        upstream_id=url or stable_id("eastmoney", row),
        content_type="NEWS",
        title=title,
        excerpt=optional_text(row, "摘要", "内容"),
        publisher="东方财富",
        canonical_url=url,
        published_at=published,
        precision="SECOND" if published and published.second else "MINUTE" if published else "UNKNOWN",
        metadata={"source": "stock_info_global_em"},
    )


def map_cls(row: dict[str, Any]) -> dict[str, Any]:
    published = parse_shanghai_datetime(
        " ".join(filter(None, [optional_text(row, "发布日期", "日期"), optional_text(row, "发布时间", "时间")]))
    )
    content = optional_text(row, "内容", "摘要")
    title = optional_text(row, "标题") or ""
    return item(
        upstream_id=stable_id("cls", row),
        content_type="FLASH",
        title=title,
        excerpt=content,
        publisher="财联社",
        canonical_url=None,
        published_at=published,
        precision="SECOND" if published and published.second else "MINUTE" if published else "UNKNOWN",
        metadata={"source": "stock_info_global_cls"},
    )


def map_notice(row: dict[str, Any]) -> dict[str, Any]:
    raw_date = first(row, "公告日期", "日期")
    published_date = parse_date_value(raw_date)
    code = optional_text(row, "代码", "股票代码", "证券代码")
    url = optional_text(row, "网址", "链接", "url")
    return item(
        upstream_id=url or stable_id("notice", row),
        content_type="NOTICE",
        title=text(row, "公告标题", "标题"),
        excerpt=None,
        publisher=optional_text(row, "名称", "公司名称"),
        canonical_url=url,
        published_at=None,
        published_date=published_date,
        precision="DATE" if published_date else "UNKNOWN",
        security_hints=[code] if code and code.isdigit() and len(code) == 6 else [],
        category=optional_text(row, "公告类型", "类型"),
        metadata={"source": "akshare_notice"},
        quality_flags=["POSSIBLE_SECURITY_OMISSION"],
    )


def item(
    *,
    upstream_id: str,
    content_type: str,
    title: str,
    excerpt: str | None,
    publisher: str | None,
    canonical_url: str | None,
    published_at: datetime | None,
    precision: str,
    metadata: dict[str, Any],
    published_date: str | None = None,
    security_hints: list[str] | None = None,
    category: str | None = None,
    quality_flags: list[str] | None = None,
) -> dict[str, Any]:
    raw = {
        "upstreamId": upstream_id,
        "contentType": content_type,
        "title": title,
        "excerpt": excerpt,
        "publisher": publisher,
        "canonicalUrl": canonical_url,
        "alternateUrls": [],
        "publishedAt": published_at.isoformat(timespec="milliseconds") if published_at else None,
        "publishedDate": published_date,
        "publishedPrecision": precision,
        "sourceDiscoveredAt": None,
        "language": "zh-CN",
        "sourceCountry": "CN",
        "securityHints": security_hints or [],
        "category": category,
        "sourceMetadata": metadata,
        "qualityFlags": quality_flags or [],
    }
    raw["rawPayloadHash"] = hashlib.sha256(stable_json(raw).encode()).hexdigest()
    return raw


def envelope(request: Request, items: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "requestId": request_id(request),
        "retrievedAt": datetime.now(tz=ZoneInfo("UTC")).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "items": items,
        "warnings": [],
    }


def error_payload(request: Request, code: str, retryable: bool, message: str) -> dict[str, Any]:
    return {"code": code, "retryable": retryable, "message": message, "requestId": request_id(request)}


def request_id(request: Request) -> str:
    value = getattr(request.state, "request_id", None)
    if not value:
        value = str(uuid.uuid4())
        request.state.request_id = value
    return value


def text(row: dict[str, Any], *keys: str) -> str:
    value = optional_text(row, *keys)
    if value is None:
        raise BridgeError("UPSTREAM_SCHEMA_CHANGED", False, f"上游缺少字段 {keys[0]}", 502)
    return value


def optional_text(row: dict[str, Any], *keys: str) -> str | None:
    value = first(row, *keys)
    if value is None:
        return None
    rendered = str(value).strip()
    return rendered or None


def first(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    return None


def clean(value: Any) -> Any:
    if value is None or (not isinstance(value, (list, dict)) and pd.isna(value)):
        return None
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()
    return value.item() if hasattr(value, "item") else value


def parse_compact_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y%m%d").date()
    except ValueError as error:
        raise ValueError("日期不存在") from error


def parse_date_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.strftime("%Y-%m-%d")
    rendered = str(value).strip().replace("/", "-")
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(rendered[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    raise BridgeError("UPSTREAM_SCHEMA_CHANGED", False, "公告日期格式变化", 502)


def parse_shanghai_datetime(value: Any) -> datetime | None:
    if value is None or not str(value).strip():
        return None
    if isinstance(value, pd.Timestamp):
        parsed = value.to_pydatetime()
    elif isinstance(value, datetime):
        parsed = value
    else:
        rendered = str(value).strip().replace("/", "-")
        parsed = None
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y%m%d %H:%M:%S", "%Y%m%d %H:%M"):
            try:
                parsed = datetime.strptime(rendered, fmt)
                break
            except ValueError:
                continue
        if parsed is None:
            raise BridgeError("UPSTREAM_SCHEMA_CHANGED", False, "发布时间格式变化", 502)
    return parsed.replace(tzinfo=SHANGHAI) if parsed.tzinfo is None else parsed.astimezone(SHANGHAI)


def stable_id(prefix: str, row: dict[str, Any]) -> str:
    return f"{prefix}:{hashlib.sha256(stable_json(row).encode()).hexdigest()}"


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


app = create_app()
