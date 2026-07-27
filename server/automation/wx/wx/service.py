"""发图文的高层编排：封面 -> 正文图 -> 拼 content -> 建草稿 -> 可选发布。

publish_article 是对外的一键入口，把零散的微信接口串成完整流程。
"""
from __future__ import annotations

import logging
from datetime import datetime

from .client import WeixinClient
from .config import get_account
from .content import build_content
from .errors import WeixinError
from .types import AccountConfig, ArticleSpec, PublishResult, UploadedImage

logger = logging.getLogger("wx.service")


def publish_article(account: str | AccountConfig, spec: ArticleSpec) -> PublishResult:
    """一键发图文。

    步骤：
    1. access_token（client 内部自动管理，无需关心）
    2. 准备封面 thumb_media_id：账号配置有就复用；否则上传 cover_path
       （或第一张正文图）走 material/add_material 拿永久素材 id
    3. 逐张压缩正文图 -> uploadimg 拿 mmbiz URL
    4. 拼 content HTML
    5. draft/add 拿草稿 media_id
    6. 可选 freepublish/submit 提交发布（异步审核）

    返回 PublishResult，失败时 success=False 且 error 带原因。
    """
    acc = get_account(account) if isinstance(account, str) else account
    client = WeixinClient(acc)
    result = PublishResult(success=False)

    try:
        # 1. 封面
        thumb_media_id = acc.thumb_media_id
        if not thumb_media_id:
            cover_path = (
                spec.cover_path
                or (spec.image_paths[0] if spec.image_paths else None)
                or acc.default_thumb_path
                or None
            )
            if not cover_path:
                raise WeixinError(
                    "缺少封面：accounts.json 未设 thumb_media_id，且未提供 cover_path 或正文图"
                )
            logger.info("上传封面永久素材: %s", cover_path)
            material = client.add_permanent_material(cover_path, "image")
            thumb_media_id = material.media_id
        result.thumb_media_id = thumb_media_id

        # 2. 正文图
        uploaded: list[UploadedImage] = []
        for p in spec.image_paths:
            logger.info("上传正文图: %s", p)
            uploaded.append(client.upload_article_image(p))
        result.images = uploaded

        ok_count = sum(1 for i in uploaded if i.success)
        if uploaded and ok_count == 0:
            raise WeixinError("所有正文图上传失败")
        if ok_count < len(uploaded):
            logger.warning("正文图部分失败: %d/%d", ok_count, len(uploaded))

        # 3. 拼 content + 建草稿
        content = build_content(uploaded, spec.intro)
        media_id = client.add_draft(spec, content, thumb_media_id)
        result.media_id = media_id
        logger.info("草稿创建成功 media_id=%s", media_id)

        # 4. 可选发布
        if spec.submit_publish:
            publish_id = client.freepublish_submit(media_id)
            result.publish_id = publish_id
            result.submitted = True
            logger.info("已提交发布 publish_id=%s", publish_id)

        result.success = True
    except WeixinError as exc:
        result.success = False
        result.error = str(exc)
        logger.exception("发图文失败: %s", exc)
    except Exception as exc:  # noqa: BLE001
        result.success = False
        result.error = f"unexpected: {exc}"
        logger.exception("发图文异常")
    return result


def build_default_title(account: AccountConfig, now: datetime | None = None) -> str:
    """按账号 title_template 生成标题，{date} 替换为 YYYYMMDD。"""
    ts = now or datetime.now()
    return account.title_template.format(date=ts.strftime("%Y%m%d"))
