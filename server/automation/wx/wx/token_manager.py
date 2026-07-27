"""access_token 管理：stable_token + 进程内缓存 + 跨进程文件缓存 + 失效重试。

为什么用 stable_token 而不是老的 cgi-bin/token：
老接口多实例并发刷新会互相覆盖，后拿的让前一个失效。
stable_token 默认 force_refresh=false，微信后端会复用未过期的 token，不重复刷新。
只有在收到 40001/42001 这类 token 失效错误时，才用一次 force_refresh=true 兜底。

缓存两层：
1. 进程内字典 + 锁（同进程多线程安全）
2. token_cache.json 文件（跨进程共享，避免多进程都去刷 token 互踩）
"""
from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from typing import Any

import requests

from .config import get_settings
from .errors import TokenError


@dataclass
class TokenEntry:
    access_token: str
    expires_at: float  # unix 时间戳，到期时间

    def is_valid(self) -> bool:
        """是否仍然有效（留出提前刷新余量）。"""
        margin = get_settings().token_refresh_margin
        return bool(self.access_token) and time.time() < self.expires_at - margin


class TokenManager:
    """单个 appid 的 token 管理器，线程安全。"""

    def __init__(self, appid: str, secret: str) -> None:
        self.appid = appid
        self.secret = secret
        self._lock = threading.Lock()
        self._cache: TokenEntry | None = None

    # ---- 文件缓存（跨进程）----
    def _read_file_cache(self) -> TokenEntry | None:
        path = get_settings().token_cache_path
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            item: dict[str, Any] | None = data.get(self.appid)
            if not item:
                return None
            return TokenEntry(
                access_token=item["access_token"],
                expires_at=float(item["expires_at"]),
            )
        except (json.JSONDecodeError, KeyError, ValueError, OSError):
            return None

    def _write_file_cache(self, entry: TokenEntry) -> None:
        path = get_settings().token_cache_path
        data: dict[str, Any] = {}
        if path.exists():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data = loaded
            except (json.JSONDecodeError, OSError):
                data = {}
        data[self.appid] = {
            "access_token": entry.access_token,
            "expires_at": entry.expires_at,
        }
        try:
            path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except OSError:
            # 缓存写失败不影响主流程，进程内缓存仍可用
            pass

    # ---- 向微信要 token ----
    def _fetch_from_weixin(self, force_refresh: bool) -> TokenEntry:
        settings = get_settings()
        url = f"{settings.wx_api_base}/cgi-bin/stable_token"
        payload = {
            "grant_type": "client_credential",
            "appid": self.appid,
            "secret": self.secret,
            "force_refresh": force_refresh,
        }
        try:
            resp = requests.post(url, json=payload, timeout=10)
            resp.raise_for_status()
        except requests.RequestException as exc:
            raise TokenError(f"request stable_token failed: {exc}") from exc

        data = resp.json()
        if "access_token" not in data:
            errcode = data.get("errcode", -1)
            errmsg = data.get("errmsg", "unknown")
            raise TokenError(f"stable_token error: [{errcode}] {errmsg}")

        access_token = data["access_token"]
        expires_in = int(data.get("expires_in", 7200))
        entry = TokenEntry(
            access_token=access_token,
            expires_at=time.time() + expires_in,
        )
        self._cache = entry
        self._write_file_cache(entry)
        return entry

    # ---- 对外 ----
    def get_token(self, force_refresh: bool = False) -> str:
        """返回有效 token。

        force_refresh=True 时强制刷新（仅在收到 40001/42001 后兜底用），
        否则会优先用进程内缓存，其次文件缓存，最后才请求微信。
        """
        with self._lock:
            if not force_refresh and self._cache and self._cache.is_valid():
                return self._cache.access_token

            if not force_refresh:
                file_entry = self._read_file_cache()
                if file_entry and file_entry.is_valid():
                    self._cache = file_entry
                    return file_entry.access_token

            entry = self._fetch_from_weixin(force_refresh=force_refresh)
            return entry.access_token


# 全局：每个 appid 一个管理器
_managers: dict[str, TokenManager] = {}
_managers_lock = threading.Lock()


def get_token_manager(appid: str, secret: str) -> TokenManager:
    """取/建 appid 对应的 TokenManager。secret 变更会重建。"""
    with _managers_lock:
        mgr = _managers.get(appid)
        if mgr is None or mgr.secret != secret:
            mgr = TokenManager(appid, secret)
            _managers[appid] = mgr
        return mgr
