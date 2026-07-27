"""拼装图文正文 content HTML，使用独立模板文件。

模板放 wx/templates/<name>.html，支持两个占位符：
  {{INTRO}}  - 前言段（已 HTML 转义），放在图片上方
  {{IMAGES}} - 正文图片 HTML（每张图一段：居中图 + 灰色文件名标注）

默认 default 模板沿用 Link-Matrix 那套秀米风格：
顶部装饰 gif + 「点击蓝字关注我们」+ 分隔线 + [前言/图片] + 底部「图片源自网络侵立删 / 点个在看」+ 装饰。
"""
from __future__ import annotations

import html
from pathlib import Path

from .types import UploadedImage

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
DEFAULT_TEMPLATE = "default"


def load_template(name: str = DEFAULT_TEMPLATE) -> str:
    """读取模板文件。name 不含扩展名，对应 templates/<name>.html。"""
    path = TEMPLATES_DIR / f"{name}.html"
    if not path.exists():
        raise FileNotFoundError(f"content 模板不存在: {path}")
    return path.read_text(encoding="utf-8")


def _build_image_html(img: UploadedImage) -> str:
    """单张正文图的 HTML：居中图片 + 灰色文件名标注（与原模板风格一致）。

    图片统一是 JPEG（image.py 压缩时已转），所以 data-type 固定 jpeg。
    标注用文件名去扩展名，对应该图的来源说明。
    """
    filename = Path(img.path).name
    dot = filename.rfind(".")
    caption = filename[:dot] if dot != -1 else filename
    return (
        '<p style="text-align: center;">'
        f'<img class="rich_pages wxw-img" data-src="{img.url}" data-type="jpeg" style="">'
        "</p>"
        '<p style="text-align: center;">'
        '<span style="outline: 0px;color: rgb(136, 136, 136);font-size: 12px;'
        f'letter-spacing: 0.578px;">{html.escape(caption)}<br /></span>'
        "</p>"
    )


def build_content(
    images: list[UploadedImage],
    intro: str = "",
    template: str = DEFAULT_TEMPLATE,
) -> str:
    """用模板拼正文：顶部装饰 + 前言 + 图片 + 底部文案。

    上传失败的图跳过；一张可用图都没有时 {{IMAGES}} 为空，正文只剩模板框架。
    """
    tpl = load_template(template)
    images_html = "".join(
        _build_image_html(img) for img in images if img.success and img.url
    )
    intro_html = (
        f'<p style="text-align:center;">{html.escape(intro)}</p>' if intro else ""
    )
    return tpl.replace("{{INTRO}}", intro_html).replace("{{IMAGES}}", images_html)
