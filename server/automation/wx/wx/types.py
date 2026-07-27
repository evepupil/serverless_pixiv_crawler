"""数据模型：账号配置、文章规格、各类结果。

全部用 dataclass，类型标注贯穿，给 IDE 和静态检查用。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AccountConfig:
    """一个公众号账号的配置（对应 accounts.json 里的一项）。"""

    name: str
    appid: str
    secret: str
    author: str = "编辑部"
    # 标题模板，支持 {date} 占位（YYYYMMDD）
    title_template: str = "每日萌图 {date}"
    digest: str = "喜欢的话就点个在看吧"
    # 封面永久素材 media_id；为空时需要在发布时上传 cover_path 拿永久素材
    thumb_media_id: str = ""
    # 默认封面图本地路径（thumb_media_id 为空且未传 cover_path 时使用）
    default_thumb_path: str = ""
    need_open_comment: int = 1
    only_fans_can_comment: int = 1


@dataclass
class ArticleSpec:
    """发一篇图文的输入规格。"""

    title: str
    author: str = ""
    digest: str = ""
    # 正文图片本地路径列表（会被压缩到 ≤1MB 再上传）
    image_paths: list[str] = field(default_factory=list)
    # 封面图本地路径；None 则用第一张正文图
    cover_path: str | None = None
    # 正文前言，放在图片上方（可选）
    intro: str = ""
    # 存草稿后是否直接提交发布（freepublish/submit）
    submit_publish: bool = False
    need_open_comment: int | None = None
    only_fans_can_comment: int | None = None


@dataclass
class MaterialResult:
    """上传永久素材的结果。"""

    media_id: str
    url: str = ""


@dataclass
class UploadedImage:
    """一张正文图上传后的结果。"""

    path: str
    url: str
    success: bool = True
    error: str = ""


@dataclass
class DraftResult:
    """新建草稿的结果。"""

    media_id: str
    images: list[UploadedImage] = field(default_factory=list)
    thumb_media_id: str = ""


@dataclass
class PublishResult:
    """一键发图文的最终结果。"""

    success: bool
    media_id: str = ""
    publish_id: str = ""
    images: list[UploadedImage] = field(default_factory=list)
    thumb_media_id: str = ""
    submitted: bool = False
    error: str = ""
    raw: dict[str, Any] = field(default_factory=dict)
