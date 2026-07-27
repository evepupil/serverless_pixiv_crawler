"""调用示例：两种用法。

方式一：直接 import 用 Python 库（同进程，适合脚本/定时任务）
方式二：通过 HTTP 调用本服务（适合其他系统远程调用）

运行前：先配好 accounts.json（填真实 appid/secret），并准备几张本地图片。
"""
from __future__ import annotations

# 让 examples 目录能 import 到 wx 包（把上级目录加入 sys.path）
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def demo_library() -> None:
    """方式一：直接用库。"""
    from wx import ArticleSpec, publish_article

    spec = ArticleSpec(
        title="今日萌图",
        author="编辑部",
        digest="喜欢就点个在看吧",
        image_paths=[
            "/abs/path/img1.jpg",
            "/abs/path/img2.jpg",
        ],
        cover_path="/abs/path/cover.jpg",
        intro="一起来看看今天的精选",
        submit_publish=False,  # 只存草稿，不直接发布
    )
    result = publish_article("demo_mp", spec)  # "demo_mp" 是 accounts.json 里的 name
    print(result)


def demo_http() -> None:
    """方式二：通过 HTTP 调用本服务。先启动服务：python main.py"""
    import requests

    base = "http://127.0.0.1:3004"
    api_key = "your_wx_api_key"

    # 健康检查
    print(requests.get(f"{base}/health").json())

    # 一键发图文
    resp = requests.post(
        f"{base}/publish",
        headers={"X-API-Key": api_key},
        json={
            "account": "demo_mp",
            "title": "今日萌图",
            "image_paths": ["/abs/path/img1.jpg", "/abs/path/img2.jpg"],
            "cover_path": "/abs/path/cover.jpg",
            "intro": "一起来看看",
            "submit_publish": False,
        },
        timeout=60,
    )
    print(resp.json())


if __name__ == "__main__":
    # 默认演示库用法；想试 HTTP 调用改成 demo_http()
    demo_library()
