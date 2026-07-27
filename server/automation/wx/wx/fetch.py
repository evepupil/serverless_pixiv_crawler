"""通过爬虫 proxy 用 pid 拉图到本地临时文件。

发文服务和爬虫同部署,proxy 在本机(localhost:3000),拉图零延迟。
pids 模式下,publish_article 用它把 pid 转成本地路径,再走现有 image_paths 流程。
"""
from __future__ import annotations

import logging
import os
import tempfile

import requests

from .config import get_settings

logger = logging.getLogger("wx.fetch")


def fetch_image_via_proxy(pid: str, size: str = "regular") -> str:
    """用爬虫 proxy 拉 pid 的图,存临时文件,返回绝对路径。

    Args:
        pid: 作品 pid
        size: 拉取尺寸(regular / original / small / thumb_mini)

    Returns:
        本地临时文件绝对路径

    Raises:
        requests.HTTPError: proxy 返回非 2xx
        RuntimeError: proxy 返回非图片(可能是错误 JSON)
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
            f"proxy 返回非图片 content-type={content_type}, pid={pid}(可能 pid 不存在或 proxy 报错)"
        )

    suffix = ".jpg"
    if "png" in content_type:
        suffix = ".png"
    elif "webp" in content_type:
        suffix = ".webp"

    fd, path = tempfile.mkstemp(suffix=suffix, prefix=f"pid_{pid}_")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(resp.content)
    except Exception:
        os.unlink(path)
        raise
    logger.info(
        "proxy 拉图成功 pid=%s size=%s -> %s (%d bytes)",
        pid, size, path, len(resp.content),
    )
    return path
