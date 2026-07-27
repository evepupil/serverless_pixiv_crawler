"""正文图预处理：压缩到 ≤1MB 并转 JPEG，供 media/uploadimg。

media/uploadimg 的硬限制：仅 jpg/png，单文件 ≤1MB。
直接传原图（尤其 original 尺寸）常超 1MB 被静默拒绝，所以上传前先压一遍。

策略：按最长边逐步缩小，每个尺寸下从高到低试 JPEG 质量，直到 ≤1MB。
统一转 JPEG：兼容性最好、最容易控大小；PNG 大图压不到 1MB。
"""
from __future__ import annotations

import io

from PIL import Image

from .config import UPLOADIMG_MAX_BYTES
from .errors import ImageProcessError

# 压缩时尝试的 JPEG 质量档位，从高到低
_QUALITY_STEPS = (90, 85, 80, 75, 70, 60, 50)
# 最长边上限，逐步缩小
_MAX_DIM_STEPS = (2000, 1600, 1280, 1024, 800)


def _load_image(path: str) -> Image.Image:
    try:
        img = Image.open(path)
        img.load()
    except (FileNotFoundError, OSError) as exc:
        raise ImageProcessError(f"打开图片失败: {path}: {exc}") from exc

    # 去掉透明通道，合成白底再转 RGB，避免透明 PNG 压成 JPEG 后底色发黑
    if img.mode in ("RGBA", "LA"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode == "P":
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")
    return img


def _encode_jpeg(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def compress_for_uploadimg(path: str) -> tuple[bytes, str]:
    """把任意图片压成 ≤1MB 的 JPEG 字节流。

    返回 (data, content_type)。content_type 固定为 image/jpeg。
    """
    img = _load_image(path)

    best: bytes | None = None
    for max_dim in _MAX_DIM_STEPS:
        w, h = img.size
        scale = min(1.0, max_dim / max(w, h))
        if scale < 1.0:
            resized = img.resize(
                (int(w * scale), int(h * scale)), Image.Resampling.LANCZOS
            )
        else:
            resized = img

        for q in _QUALITY_STEPS:
            data = _encode_jpeg(resized, q)
            if len(data) <= UPLOADIMG_MAX_BYTES:
                return data, "image/jpeg"
            # 保留当前尺寸下最小的一个，作为兜底
            if best is None or len(data) < len(best):
                best = data

    if best is None:
        raise ImageProcessError(f"无法压缩到 1MB 以内: {path}")
    return best, "image/jpeg"
