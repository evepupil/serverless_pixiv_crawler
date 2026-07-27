"""uvicorn 启动入口。

用法：
  python main.py
  uvicorn main:app --host 127.0.0.1 --port 3004

端口、监听地址、鉴权等见 wx/config.py 的环境变量。
"""
from __future__ import annotations

import uvicorn

from wx.api import create_app
from wx.config import get_settings

app = create_app()


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        reload=False,
    )


if __name__ == "__main__":
    main()
