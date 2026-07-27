"""通过爬虫 proxy 用 pid 拉图到本地临时文件。

发文服务和爬虫同部署,proxy 在本机,拉图零延迟。
文件名固定为 `@<作者> pid_<pid>.jpg`,content 模板的图片标注会直接用这个文件名,
省得再单独传 caption。
"""
from __future__ import annotations

import logging
import os
import re
import tempfile

import requests

from .config import get_settings

logger = logging.getLogger("wx.fetch")


def _sanitize_filename(name: str) -> str:
    """去掉文件名非法字符。"""
    cleaned = re.sub(r'[\\/:*?"<>|]', "_", name or "").strip()
    return cleaned or "unknown"


def _get_author_name(pid: str) -> str:
    """查爬虫拿作者名(author_name),失败返回 unknown。"""
    settings = get_settings()
    url = f"{settings.server_base_url}/?action=get-pic&pid={pid}"
    headers = {}
    if settings.server_api_key:
        headers["X-API-Key"] = settings.server_api_key
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json().get("data") or {}
        return data.get("author_name") or "unknown"
    except Exception as exc:  # noqa: BLE001
        logger.warning("查作者失败 pid=%s: %s", pid, exc)
        return "unknown"


def fetch_image_via_proxy(pid: str, size: str = "regular") -> str:
    """用爬虫 proxy 拉 pid 的图,存临时文件,返回绝对路径。

    文件名:`@<作者名> pid_<pid>.<ext>`,供 content 模板做图片标注。
    """
    settings = get_settings()
    url = f"{settings.server_base_url}/?action=proxy&pid={pid}&size={size}"
    headers = {"Accept": "image/*"}
    if settings.server_api_key:
        headers["X-API-Key"] = settings.server_api_key

    resp = requests.get(url, headers=headers, timeout=60)
    resp.raise_for_status()

    content_type = resp.headers.get("Content-Type", "")
    if not content_type.startswith("image/"):
        raise RuntimeError(
            f"proxy 返回非图片 content-type={content_type}, pid={pid}"
        )

    suffix = ".jpg"
    if "png" in content_type:
        suffix = ".png"
    elif "webp" in content_type:
        suffix = ".webp"

    author = _sanitize_filename(_get_author_name(pid))
    filename = f"@{author} pid_{pid}{suffix}"
    path = os.path.join(tempfile.gettempdir(), filename)

    with open(path, "wb") as f:
        f.write(resp.content)

    logger.info(
        "proxy 拉图成功 pid=%s size=%s -> %s (%d bytes)",
        pid, size, path, len(resp.content),
    )
    return path
