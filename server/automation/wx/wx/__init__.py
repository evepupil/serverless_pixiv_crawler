"""微信公众号自动化 HTTP 服务包。

对外暴露：
- WeixinClient：微信开放平台 API 的薄封装
- publish_article：一键发图文的高层函数
- create_app：FastAPI 应用工厂
- 各 dataclass 与异常类型
"""

from .types import (
    AccountConfig,
    ArticleSpec,
    DraftResult,
    MaterialResult,
    PublishResult,
    UploadedImage,
)
from .errors import (
    AccountNotFoundError,
    ImageProcessError,
    TokenError,
    WeixinApiError,
    WeixinError,
)
from .client import WeixinClient
from .service import build_default_title, publish_article
from .api import create_app

__all__ = [
    "AccountConfig",
    "ArticleSpec",
    "DraftResult",
    "MaterialResult",
    "PublishResult",
    "UploadedImage",
    "WeixinError",
    "WeixinApiError",
    "TokenError",
    "AccountNotFoundError",
    "ImageProcessError",
    "WeixinClient",
    "publish_article",
    "build_default_title",
    "create_app",
]

__version__ = "0.1.0"
