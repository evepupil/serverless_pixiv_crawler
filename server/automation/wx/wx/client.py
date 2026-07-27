"""WeixinClient：微信公众号开放平台 API 的薄封装。

覆盖发图文全流程：access_token、永久素材（封面）、正文图、草稿、发布。
所有接口遇到 token 失效类错误（40001/42001）会自动强刷一次重试。
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import requests

from .config import get_settings
from .errors import TOKEN_RETRYABLE_ERRCODES, WeixinApiError
from .image import compress_for_uploadimg
from .token_manager import get_token_manager
from .types import AccountConfig, ArticleSpec, MaterialResult, UploadedImage

logger = logging.getLogger("wx.client")


def _parse_json(resp: requests.Response) -> dict[str, Any]:
    """解析响应。微信接口正常都返回 JSON。"""
    try:
        return resp.json()
    except ValueError as exc:
        raise WeixinApiError(
            -1,
            f"non-json response (status={resp.status_code}): {resp.text[:200]}",
            {"status_code": resp.status_code},
        ) from exc


class WeixinClient:
    """一个公众号账号对应的 API 客户端。"""

    def __init__(self, account: AccountConfig) -> None:
        self.account = account
        self._token_mgr = get_token_manager(account.appid, account.secret)

    # ---------- access_token ----------
    def get_access_token(self, force_refresh: bool = False) -> str:
        return self._token_mgr.get_token(force_refresh=force_refresh)

    # ---------- 底层统一调用 ----------
    def _call(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
        timeout: int = 30,
    ) -> dict[str, Any]:
        """统一调用微信接口。

        自动带 access_token；遇 token 失效错误强刷一次重试；errcode 非 0 抛 WeixinApiError。
        注意：json_body 与 files 不能同时传（requests 限制），调用方自行保证。
        """
        base = get_settings().wx_api_base
        token = self.get_access_token()
        url = f"{base}{path}"

        def do_request(tok: str) -> requests.Response:
            merged = {"access_token": tok, **(params or {})}
            return requests.request(
                method,
                url,
                params=merged,
                json=json_body,
                files=files,
                timeout=timeout,
            )

        resp = do_request(token)
        result = _parse_json(resp)

        errcode = result.get("errcode", 0)
        if errcode in TOKEN_RETRYABLE_ERRCODES:
            logger.warning("token 失效(errcode=%s)，强刷后重试一次", errcode)
            token = self.get_access_token(force_refresh=True)
            resp = do_request(token)
            result = _parse_json(resp)
            errcode = result.get("errcode", 0)

        if errcode != 0:
            raise WeixinApiError(errcode, result.get("errmsg", ""), result)
        return result

    # ---------- 正文图：media/uploadimg ----------
    def upload_article_image(self, path: str) -> UploadedImage:
        """压缩后上传正文图，返回 mmbiz URL。"""
        try:
            data, content_type = compress_for_uploadimg(path)
        except Exception as exc:  # noqa: BLE001
            return UploadedImage(path=path, url="", success=False, error=str(exc))

        result = self._call(
            "POST",
            "/cgi-bin/media/uploadimg",
            files={"media": (Path(path).name, data, content_type)},
        )
        url = result.get("url", "")
        if not url:
            return UploadedImage(path=path, url="", success=False, error="微信未返回 url")
        return UploadedImage(path=path, url=url, success=True)

    # ---------- 永久素材：material/add_material（封面用）----------
    def add_permanent_material(
        self, path: str, material_type: str = "image"
    ) -> MaterialResult:
        """上传永久素材，返回 media_id（封面 thumb_media_id 必须来自这里）。"""
        with open(path, "rb") as f:
            data = f.read()
        result = self._call(
            "POST",
            "/cgi-bin/material/add_material",
            params={"type": material_type},
            files={"media": (Path(path).name, data)},
        )
        return MaterialResult(media_id=result["media_id"], url=result.get("url", ""))

    # ---------- 草稿：draft/add ----------
    def add_draft(self, article: ArticleSpec, content: str, thumb_media_id: str) -> str:
        """新建草稿，返回草稿 media_id。"""
        need_open = (
            self.account.need_open_comment
            if article.need_open_comment is None
            else article.need_open_comment
        )
        only_fans = (
            self.account.only_fans_can_comment
            if article.only_fans_can_comment is None
            else article.only_fans_can_comment
        )

        body = {
            "articles": [
                {
                    "title": article.title,
                    "author": article.author or self.account.author,
                    "digest": article.digest or self.account.digest,
                    "content": content,
                    "thumb_media_id": thumb_media_id,
                    "need_open_comment": int(need_open),
                    "only_fans_can_comment": int(only_fans),
                }
            ]
        }
        result = self._call("POST", "/cgi-bin/draft/add", json_body=body)
        return result["media_id"]

    def get_draft(self, media_id: str) -> dict[str, Any]:
        return self._call(
            "POST", "/cgi-bin/draft/get", json_body={"media_id": media_id}
        )

    def delete_draft(self, media_id: str) -> dict[str, Any]:
        return self._call(
            "POST", "/cgi-bin/draft/delete", json_body={"media_id": media_id}
        )

    def draft_count(self) -> int:
        result = self._call("POST", "/cgi-bin/draft/count")
        return int(result.get("total_count", 0))

    # ---------- 发布：freepublish ----------
    def freepublish_submit(self, media_id: str) -> str:
        """提交草稿发布，返回 publish_id（异步审核，需轮询 get 查终态）。"""
        result = self._call(
            "POST",
            "/cgi-bin/freepublish/submit",
            json_body={"media_id": media_id},
        )
        return result.get("publish_id", "")

    def freepublish_get(self, publish_id: str) -> dict[str, Any]:
        return self._call(
            "POST",
            "/cgi-bin/freepublish/get",
            json_body={"publish_id": publish_id},
        )
