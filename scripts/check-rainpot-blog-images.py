#!/usr/bin/env python3
"""Validate RainPot blog Markdown image references and local image dimensions.

Usage:
  python scripts/check-rainpot-blog-images.py /path/to/RainPot.github.io src/content/blog/post.md

Checks:
  - Markdown image refs of the form ![alt](/images/...) exist under public/.
  - Basic PNG/JPEG/WebP pixel dimensions can be read without Pillow.
  - Referenced images meet a minimum width threshold.

Default minimum width is 1400px. Override with --min-width 1800 for stricter
pipeline/overview/failure figures.
"""
from __future__ import annotations

import argparse
import re
import struct
from pathlib import Path

IMAGE_RE = re.compile(r"!\[[^\]]*\]\((/images/[^)\s]+)\)")


def png_size(data: bytes) -> tuple[int, int] | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n") and data[12:16] == b"IHDR":
        return struct.unpack(">II", data[16:24])
    return None


def webp_size(data: bytes) -> tuple[int, int] | None:
    if not (data[:4] == b"RIFF" and data[8:12] == b"WEBP"):
        return None
    chunk = data[12:16]
    if chunk == b"VP8X" and len(data) >= 30:
        w = 1 + int.from_bytes(data[24:27], "little")
        h = 1 + int.from_bytes(data[27:30], "little")
        return w, h
    if chunk == b"VP8 " and len(data) >= 30:
        start = 23
        if data[start:start + 3] == b"\x9d\x01\x2a":
            w = int.from_bytes(data[start + 3:start + 5], "little") & 0x3FFF
            h = int.from_bytes(data[start + 5:start + 7], "little") & 0x3FFF
            return w, h
    if chunk == b"VP8L" and len(data) >= 25:
        b0, b1, b2, b3 = data[21:25]
        w = 1 + (((b1 & 0x3F) << 8) | b0)
        h = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6))
        return w, h
    return None


def jpeg_size(data: bytes) -> tuple[int, int] | None:
    if not data.startswith(b"\xff\xd8"):
        return None
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        i += 2
        if marker in (0xD8, 0xD9):
            continue
        if i + 2 > len(data):
            return None
        length = int.from_bytes(data[i:i + 2], "big")
        if length < 2 or i + length > len(data):
            return None
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h = int.from_bytes(data[i + 3:i + 5], "big")
            w = int.from_bytes(data[i + 5:i + 7], "big")
            return w, h
        i += length
    return None


def image_size(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()[:4096]
    return png_size(data) or jpeg_size(data) or webp_size(data)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("repo", type=Path)
    ap.add_argument("markdown", type=Path)
    ap.add_argument("--min-width", type=int, default=1400)
    args = ap.parse_args()

    repo = args.repo.resolve()
    md = args.markdown if args.markdown.is_absolute() else repo / args.markdown
    text = md.read_text(encoding="utf-8")
    refs = IMAGE_RE.findall(text)
    print(f"markdown_images {len(refs)}")
    bad: list[tuple[str, str]] = []
    for ref in refs:
        img_path = repo / "public" / ref.lstrip("/")
        if not img_path.exists():
            bad.append((ref, "missing"))
            print(ref, "MISSING")
            continue
        size = image_size(img_path)
        if not size:
            bad.append((ref, "unknown-size"))
            print(ref, "UNKNOWN_SIZE", img_path.stat().st_size)
            continue
        w, h = size
        status = "OK"
        if w < args.min_width:
            status = f"BAD width {w} < {args.min_width}"
            bad.append((ref, status))
        print(ref, f"{w}x{h}", img_path.stat().st_size, status)
    if bad:
        print("bad", bad)
        return 1
    print("bad []")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
