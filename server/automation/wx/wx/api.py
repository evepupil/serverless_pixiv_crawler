"""FastAPI 路由：把 WeixinClient 的能力暴露成 HTTP 接口。

鉴权与主服务（server/src/index.ts）保持一致：用 X-API-Key 头，
WX_API_KEY 配置后生效；WX_REQUIRE_API_KEY=false 可关（仅本机调试用）。

端点一览：
  GET  /health              健康检查
  GET  /accounts            列出账号（不暴露 secret）
  POST /publish             一键发图文（建草稿，可选直接提交发布）
  POST /draft               仅建草稿（不提交发布）
  POST /material/upload     上传永久素材，拿 thumb_media_id
  POST /freepublish         提交草稿发布，拿 publish_id
  POST /draft/delete        删除草稿
  POST /draft/get           取草稿详情
  GET  /draft/count?account 草稿箱数量
"""
from __future__ import annotations

import logging
import secrets
from dataclasses import asdict
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .client import WeixinClient
from .config import get_account, get_settings, load_accounts
from .errors import WeixinError
from .service import build_default_title, publish_article
from .types import ArticleSpec, PublishResult

logger = logging.getLogger("wx.api")


# ---------- 请求模型 ----------
class PublishRequest(BaseModel):
    """发图文请求。"""

    account: str = Field(..., description="accounts.json 里的账号 name")
    title: str | None = Field(None, description="为空且 use_default_title=true 时用账号模板生成")
    author: str | None = None
    digest: str | None = None
    image_paths: list[str] = Field(default_factory=list, description="正文图本地路径列表")
    cover_path: str | None = Field(None, description="封面图本地路径；None 且账号无 thumb_media_id 时用第一张正文图")
    intro: str = Field("", description="正文前言，放在图片上方")
    submit_publish: bool = Field(False, description="建草稿后是否直接提交发布")
    need_open_comment: int | None = None
    only_fans_can_comment: int | None = None
    use_default_title: bool = Field(True, description="title 为空时是否用账号模板生成标题")
    pids: list[str] | None = Field(None, description="作品 pid;与 image_paths 二选一,服务端用 proxy 拉图")
    image_size: str = Field("regular", description="pids 模式下拉这个尺寸")
    template: str = Field("default", description="正文模板名,对应 wx/templates/<name>.html")


class MaterialUploadRequest(BaseModel):
    account: str
    path: str
    material_type: str = Field("image", description="image 或 thumb")


class FreepublishRequest(BaseModel):
    account: str
    media_id: str


class DraftIdRequest(BaseModel):
    account: str
    media_id: str


# ---------- 鉴权 ----------
async def verify_api_key(x_api_key: str | None = Header(None, alias="X-API-Key")) -> str:
    """校验 X-API-Key，与主服务的 SERVER_API_KEY 风格一致。"""
    settings = get_settings()
    if not settings.require_api_key:
        return ""
    if not settings.api_key:
        # 要求鉴权却没配 key，直接拒服务，避免裸奔
        raise HTTPException(status_code=503, detail="WX_API_KEY 未配置，服务不可用")
    provided = x_api_key or ""
    if not secrets.compare_digest(provided, settings.api_key):
        raise HTTPException(status_code=401, detail="invalid api key")
    return provided


# ---------- 辅助 ----------
def _to_spec(req: PublishRequest) -> tuple[str, ArticleSpec]:
    """把请求转成账号名 + ArticleSpec。账号不存在会抛 AccountNotFoundError。"""
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
        template=req.template or "default",
    )
    return req.account, spec


def _result_to_dict(result: PublishResult) -> dict[str, Any]:
    return asdict(result)


def _client(account: str) -> WeixinClient:
    """按账号名构造 WeixinClient。"""
    return WeixinClient(get_account(account))


# ---------- App ----------
def create_app() -> FastAPI:
    app = FastAPI(title="微信公众号自动化", version="0.1.0")
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)

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
                {
                    "name": a.name,
                    "author": a.author,
                    "has_thumb": bool(a.thumb_media_id),
                }
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

    return app
