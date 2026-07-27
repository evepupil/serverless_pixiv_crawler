"""异常类型与微信错误码常量。

错误码含义与处理建议见 README「错误码」一节。
"""
from __future__ import annotations


class WeixinError(Exception):
    """微信自动化模块所有异常的基类。"""


class WeixinApiError(WeixinError):
    """调用微信开放平台 API 返回了 errcode 非 0。"""

    def __init__(self, errcode: int, errmsg: str, payload: dict | None = None) -> None:
        self.errcode = errcode
        self.errmsg = errmsg
        self.payload = payload or {}
        super().__init__(f"[{errcode}] {errmsg}")

    def __str__(self) -> str:
        return f"WeixinApiError(errcode={self.errcode}, errmsg={self.errmsg})"


class TokenError(WeixinError):
    """获取或刷新 access_token 失败。"""


class AccountNotFoundError(WeixinError):
    """找不到指定名称的公众号账号配置。"""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"account not found: {name}")


class ImageProcessError(WeixinError):
    """图片预处理（读取/压缩/转码）失败。"""


# ---------- 微信开放平台常见错误码 ----------
ERR_INVALID_TOKEN = 40001        # access_token 无效或过期 -> 强刷重试
ERR_INVALID_TYPE = 40004          # 媒体类型不合法
ERR_INVALID_APPID = 40005         # 不合法的 appid
ERR_INVALID_MEDIA_ID = 40007      # 不合法的 media_id（如 thumb 不是永久素材）
ERR_INVALID_SECRET = 40125        # appsecret 无效
ERR_IP_NOT_IN_WHITELIST = 40164   # 调用 IP 不在白名单（注意：不是 40001）
ERR_API_LIMIT = 45009             # 接口调用超过限制
ERR_API_UNAUTHORIZED = 48002      # API 功能未授权
ERR_TOKEN_TIMEOUT = 42001          # access_token 超时
ERR_DRAFT_NOT_FOUND = 46003       # 草稿不存在
ERR_FORCE_REFRESH_INVALID = 45166  # stable_token 的 force_refresh 参数无效

# 收到这些 errcode 时，刷新一次 token 后重试是值得的
TOKEN_RETRYABLE_ERRCODES = frozenset({ERR_INVALID_TOKEN, ERR_TOKEN_TIMEOUT})
