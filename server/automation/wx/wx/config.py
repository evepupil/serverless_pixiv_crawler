"""配置加载：环境变量 + accounts.json 多账号。

设计要点：
- 运行期配置（端口、鉴权、路径）走环境变量，与主服务风格一致
- 公众号账号走 accounts.json，支持多号，密钥不进代码
- accounts.json / token_cache.json 默认放在本模块上级目录（server/automation/wx/）
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from .errors import AccountNotFoundError
from .types import AccountConfig

# 微信开放平台 API 基础域名
WX_API_BASE = "https://api.weixin.qq.com"

# 正文图（media/uploadimg）单文件大小上限：1MB（微信硬限制）
UPLOADIMG_MAX_BYTES = 1 * 1024 * 1024

# 本包上级目录，即 server/automation/wx/，作为默认配置文件落脚点
BASE_DIR = Path(__file__).resolve().parent.parent


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    """运行期配置，从环境变量读取。单次进程内只读一次。"""

    def __init__(self) -> None:
        self.wx_api_base = _env("WX_API_BASE", WX_API_BASE)
        self.port = _env_int("WX_PORT", 3004)
        # 默认只绑本机；如需对外暴露，务必配 WX_API_KEY
        self.host = _env("WX_HOST", "127.0.0.1")
        self.api_key = _env("WX_API_KEY", "")
        self.accounts_path = Path(_env("WX_ACCOUNTS_PATH") or (BASE_DIR / "accounts.json"))
        self.token_cache_path = Path(
            _env("WX_TOKEN_CACHE_PATH") or (BASE_DIR / "token_cache.json")
        )
        # 爬虫 server proxy(pids 模式用它拉图;同部署默认本机)
        self.server_base_url = _env("SERVER_BASE_URL", "http://127.0.0.1:3000")
        self.server_api_key = _env("SERVER_API_KEY", "")
        # token 提前刷新余量（秒），默认提前 5 分钟续期
        self.token_refresh_margin = _env_int("WX_TOKEN_REFRESH_MARGIN", 300)
        self.log_level = _env("WX_LOG_LEVEL", "INFO").upper()
        # 是否强制要求 API key；生产建议开
        self.require_api_key = _env_bool("WX_REQUIRE_API_KEY", True)


_settings: Settings | None = None


def get_settings() -> Settings:
    """返回单例 Settings。"""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def load_accounts() -> list[AccountConfig]:
    """从 accounts.json 读取全部账号配置。文件不存在则返回空列表。"""
    path = get_settings().accounts_path
    if not path.exists():
        return []

    data = json.loads(path.read_text(encoding="utf-8"))
    raw_accounts = data.get("accounts", []) if isinstance(data, dict) else data

    accounts: list[AccountConfig] = []
    for item in raw_accounts:
        accounts.append(
            AccountConfig(
                name=item["name"],
                appid=item["appid"],
                secret=item["secret"],
                author=item.get("author", "编辑部"),
                title_template=item.get("title_template", "每日萌图 {date}"),
                digest=item.get("digest", "喜欢的话就点个在看吧"),
                thumb_media_id=item.get("thumb_media_id", ""),
                default_thumb_path=item.get("default_thumb_path", ""),
                need_open_comment=int(item.get("need_open_comment", 1)),
                only_fans_can_comment=int(item.get("only_fans_can_comment", 1)),
            )
        )
    return accounts


def get_account(name: str) -> AccountConfig:
    """按名称查找账号配置，找不到抛 AccountNotFoundError。"""
    for acc in load_accounts():
        if acc.name == name:
            return acc
    raise AccountNotFoundError(name)
