"""拼装图文正文 content HTML。

正文图片必须用 media/uploadimg 返回的 mmbiz 域名 URL，外链会被微信防盗链过滤。
intro 会做 HTML 转义，避免用户文本里的双引号/尖括号破坏 content 结构（社区常见坑）。
"""
from __future__ import annotations

import html

from .types import UploadedImage


def build_content(images: list[UploadedImage], intro: str = "") -> str:
    """根据上传成功的图片列表拼正文 HTML。

    - intro 放在图片上方（可选，已转义）
    - 每张图居中显示，src 用 mmbiz URL
    - 上传失败的图跳过，不塞进正文
    - 一张图都没有时给个占位，避免空正文被微信拒
    """
    parts: list[str] = []
    if intro:
        parts.append(f'<p style="text-align:center;">{html.escape(intro)}</p>')

    for img in images:
        if not img.success or not img.url:
            continue
        parts.append(
            '<p style="text-align:center;">'
            f'<img src="{img.url}" data-src="{img.url}">'
            "</p>"
        )

    if not parts:
        parts.append("<p><br></p>")
    return "".join(parts)
