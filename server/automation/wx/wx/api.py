"""FastAPI 路由:微信发文 + 素材库人工审核。

鉴权两套:
- skill 调用:`X-API-Key` 头(WX_API_KEY)
- 审核网页:密码(`X-Review-Password` 头,REVIEW_PASSWORD)

端点分组:
  微信发文(原有):/publish /draft /material/upload /freepublish /draft/get /draft/delete /draft/count
  素材库(skill):POST /api/material/pending  GET /api/approved  POST /api/material/publish
  审核(网页):   GET /api/review  POST /api/review  GET /api/material  POST /api/material/mark
  图片代理:     GET /api/image?pid(网页显示用,不鉴权,pid 不敏感)
  网页:         GET /review
"""
from __future__ import annotations

import logging
import secrets
from dataclasses import asdict
from pathlib import Path
from typing import Any

import requests
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

from .client import WeixinClient
from .config import BASE_DIR, get_account, get_settings, load_accounts
from .errors import WeixinError
from .material import (
    add_pending,
    init as material_init,
    list_approved,
    list_material,
    list_pending,
    mark as material_mark,
    mark_published,
    review_submit,
)
from .service import build_default_title, publish_article
from .types import ArticleSpec, PublishResult

logger = logging.getLogger("wx.api")


# ---------- 请求模型 ----------
class PublishRequest(BaseModel):
    account: str = Field(..., description="accounts.json 里的账号 name")
    title: str | None = Field(None)
    author: str | None = None
    digest: str | None = None
    image_paths: list[str] = Field(default_factory=list)
    cover_path: str | None = Field(None)
    intro: str = Field("")
    submit_publish: bool = Field(False)
    need_open_comment: int | None = None
    only_fans_can_comment: int | None = None
    use_default_title: bool = Field(True)
    pids: list[str] | None = Field(None)
    image_size: str = Field("regular")


class MaterialUploadRequest(BaseModel):
    account: str
    path: str
    material_type: str = Field("image")


class FreepublishRequest(BaseModel):
    account: str
    media_id: str


class DraftIdRequest(BaseModel):
    account: str
    media_id: str


# 素材库 / 审核
class PendingItem(BaseModel):
    pid: str
    score: float = 0
    column: str = ""


class PendingRequest(BaseModel):
    account: str
    items: list[PendingItem]


class ReviewSubmitRequest(BaseModel):
    account: str
    keep: list[str] = Field(default_factory=list)
    discard: list[str] = Field(default_factory=list)


class MarkRequest(BaseModel):
    account: str
    action: str
    pids: list[str]


class PublishMarkRequest(BaseModel):
    account: str
    pids: list[str]


# ---------- 鉴权 ----------
async def verify_api_key(x_api_key: str | None = Header(None, alias="X-API-Key")) -> str:
    settings = get_settings()
    if not settings.require_api_key:
        return ""
    if not settings.api_key:
        raise HTTPException(status_code=503, detail="WX_API_KEY 未配置，服务不可用")
    provided = x_api_key or ""
    if not secrets.compare_digest(provided, settings.api_key):
        raise HTTPException(status_code=401, detail="invalid api key")
    return provided


async def verify_review_password(
    x_review_password: str | None = Header(None, alias="X-Review-Password"),
) -> str:
    settings = get_settings()
    if not settings.review_password:
        return ""
    provided = x_review_password or ""
    if not secrets.compare_digest(provided, settings.review_password):
        raise HTTPException(status_code=401, detail="invalid review password")
    return provided


# ---------- 辅助 ----------
def _to_spec(req: PublishRequest) -> tuple[str, ArticleSpec]:
    acc = get_account(req.account)
    title = req.title
    if (title is None) and req.use_default_title:
        title = build_default_title(acc)
    if not title:
        title = "未命名"
    spec = ArticleSpec(
        title=title,
        author=req.author or "",
        digest=req.digest or "",
        image_paths=req.image_paths,
        cover_path=req.cover_path,
        intro=req.intro,
        submit_publish=req.submit_publish,
        need_open_comment=req.need_open_comment,
        only_fans_can_comment=req.only_fans_can_comment,
        pids=req.pids or [],
        image_size=req.image_size or "regular",
    )
    return req.account, spec


def _result_to_dict(result: PublishResult) -> dict[str, Any]:
    return asdict(result)


def _client(account: str) -> WeixinClient:
    return WeixinClient(get_account(account))


# ---------- App ----------
def create_app() -> FastAPI:
    app = FastAPI(title="微信公众号自动化", version="0.2.0")
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    material_init()

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "running",
            "accounts": len(load_accounts()),
            "auth_required": settings.require_api_key and bool(settings.api_key),
        }

    @app.get("/accounts", dependencies=[Depends(verify_api_key)])
    async def list_accounts() -> dict[str, Any]:
        accs = load_accounts()
        return {
            "accounts": [
                {"name": a.name, "author": a.author, "has_thumb": bool(a.thumb_media_id)}
                for a in accs
            ]
        }

    @app.post("/publish", dependencies=[Depends(verify_api_key)])
    async def publish(req: PublishRequest) -> dict[str, Any]:
        try:
            account_name, spec = _to_spec(req)
        except WeixinError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        result = publish_article(account_name, spec)
        return _result_to_dict(result)

    @app.post("/draft", dependencies=[Depends(verify_api_key)])
    async def draft(req: PublishRequest) -> dict[str, Any]:
        try:
            account_name, spec = _to_spec(req)
        except WeixinError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        spec.submit_publish = False
        result = publish_article(account_name, spec)
        return _result_to_dict(result)

    @app.post("/material/upload", dependencies=[Depends(verify_api_key)])
    async def material_upload(req: MaterialUploadRequest) -> dict[str, Any]:
        try:
            client = _client(req.account)
            result = client.add_permanent_material(req.path, req.material_type)
        except WeixinError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"media_id": result.media_id, "url": result.url}

    @app.post("/freepublish", dependencies=[Depends(verify_api_key)])
    async def freepublish(req: FreepublishRequest) -> dict[str, Any]:
        try:
            client = _client(req.account)
            publish_id = client.freepublish_submit(req.media_id)
        except WeixinError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"publish_id": publish_id}

    @app.post("/draft/delete", dependencies=[Depends(verify_api_key)])
    async def draft_delete(req: DraftIdRequest) -> dict[str, Any]:
        try:
            client = _client(req.account)
            result = client.delete_draft(req.media_id)
        except WeixinError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"raw": result}

    @app.post("/draft/get", dependencies=[Depends(verify_api_key)])
    async def draft_get(req: DraftIdRequest) -> dict[str, Any]:
        try:
            client = _client(req.account)
            result = client.get_draft(req.media_id)
        except WeixinError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"raw": result}

    @app.get("/draft/count", dependencies=[Depends(verify_api_key)])
    async def draft_count(account: str) -> dict[str, Any]:
        try:
            client = _client(account)
            count = client.draft_count()
        except WeixinError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"total_count": count}

    # 审核网页用的账号列表(密码鉴权,不暴露 secret)
    @app.get("/api/accounts", dependencies=[Depends(verify_review_password)])
    async def review_accounts() -> dict[str, Any]:
        return {"accounts": [{"name": a.name, "author": a.author} for a in load_accounts()]}

    # ---------- 素材库(skill 用,X-API-Key)----------
    @app.post("/api/material/pending", dependencies=[Depends(verify_api_key)])
    async def post_pending(req: PendingRequest) -> dict[str, Any]:
        n = add_pending(req.account, [it.dict() for it in req.items])
        return {"added": n}

    @app.get("/api/approved", dependencies=[Depends(verify_api_key)])
    async def get_approved(account: str, column: str, limit: int = 8) -> dict[str, Any]:
        return {"pids": list_approved(account, column, limit)}

    @app.post("/api/material/publish", dependencies=[Depends(verify_api_key)])
    async def post_publish_mark(req: PublishMarkRequest) -> dict[str, Any]:
        n = mark_published(req.account, req.pids)
        return {"marked": n}

    # ---------- 审核(网页,密码)----------
    @app.get("/api/review", dependencies=[Depends(verify_review_password)])
    async def get_review(account: str, limit: int = 20) -> dict[str, Any]:
        return {"items": list_pending(account, limit)}

    @app.post("/api/review", dependencies=[Depends(verify_review_password)])
    async def post_review(req: ReviewSubmitRequest) -> dict[str, Any]:
        return review_submit(req.account, req.keep, req.discard)

    @app.get("/api/material", dependencies=[Depends(verify_review_password)])
    async def get_material(account: str, status: str = "approved") -> dict[str, Any]:
        return {"items": list_material(account, status)}

    @app.post("/api/material/mark", dependencies=[Depends(verify_review_password)])
    async def post_mark(req: MarkRequest) -> dict[str, Any]:
        n = material_mark(req.account, req.action, req.pids)
        return {"marked": n}

    # ---------- 图片代理(网页显示,不鉴权)----------
    @app.get("/api/image")
    async def get_image(pid: str, size: str = "small") -> Response:
        s = get_settings()
        url = f"{s.server_base_url}/?action=proxy&pid={pid}&size={size}"
        headers = {}
        if s.server_api_key:
            headers["X-API-Key"] = s.server_api_key
        r = requests.get(url, headers=headers, timeout=30)
        return Response(content=r.content, media_type=r.headers.get("Content-Type", "image/jpeg"))

    # ---------- 审核网页 ----------
    @app.get("/review")
    async def review_page() -> HTMLResponse:
        html = (BASE_DIR / "review.html").read_text(encoding="utf-8")
        return HTMLResponse(html)

    return app
