from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


W = H = 1600
DEEP = "#005F63"
DEEP_2 = "#004C50"
TEAL = "#00AFA5"
BG = "#F3FAFA"
TEXT = "#111827"
MUTED = "#5D7480"
LINE = "#D6E6EA"
WHITE = "#FFFFFF"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for path in candidates:
        if path and Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def find_image(assets_dir: Path, token: str) -> Path:
    matches = [p for p in assets_dir.rglob("*") if token in p.name and p.suffix.lower() in {".jpg", ".jpeg", ".png"}]
    if not matches:
        raise FileNotFoundError(f"Missing image token: {token}")
    return matches[0]


def rounded_card(base: Image.Image, xy, radius=34, fill=WHITE, outline=LINE, width=3, shadow=True):
    x0, y0, x1, y1 = xy
    if shadow:
        sh = Image.new("RGBA", base.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(sh)
        sd.rounded_rectangle((x0 + 12, y0 + 18, x1 + 12, y1 + 18), radius=radius, fill=(0, 36, 42, 38))
        sh = sh.filter(ImageFilter.GaussianBlur(18))
        base.alpha_composite(sh)
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def text_centered(d: ImageDraw.ImageDraw, box, text, font_obj, fill):
    x0, y0, x1, y1 = box
    bbox = d.textbbox((0, 0), text, font=font_obj)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((x0 + (x1 - x0 - tw) / 2, y0 + (y1 - y0 - th) / 2 - 2), text, font=font_obj, fill=fill)


def chip(d, x, y, text, fill="#E8F7F7", fg=DEEP_2, outline="#B9DDE0"):
    f = font(34, bold=True)
    pad_x = 30
    bbox = d.textbbox((0, 0), text, font=f)
    w = bbox[2] - bbox[0] + pad_x * 2
    h = 72
    d.rounded_rectangle((x, y, x + w, y + h), radius=28, fill=fill, outline=outline, width=2)
    d.text((x + pad_x, y + 18), text, font=f, fill=fg)
    return w


def build(assets_dir: Path, output: Path):
    output.parent.mkdir(parents=True, exist_ok=True)
    src = find_image(assets_dir, "20260510154315_340_2")
    product = Image.open(src).convert("RGB")
    crop = product.crop((25, 305, 1380, 960))
    crop = ImageOps.expand(crop, border=18, fill="white")
    crop.thumbnail((1280, 560), Image.Resampling.LANCZOS)
    product_rgba = crop.convert("RGBA")

    base = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(base)

    for y in range(H):
        shade = int(250 - y * 10 / H)
        d.line((0, y, W, y), fill=(shade, 255, 255, 255))

    d.rectangle((0, 0, W, 188), fill=DEEP)
    d.rectangle((0, 188, W, 194), fill=TEAL)
    d.text((110, 60), "ROGERSENSE", font=font(42, bold=True), fill=WHITE)
    d.text((112, 110), "SYSTEM SOLUTIONS", font=font(20, bold=True), fill="#BEEBE8")
    d.text((1170, 78), "www.rogersense.com", font=font(28, bold=True), fill=WHITE)

    d.text((110, 250), "Bluetooth Proximity", font=font(82, bold=True), fill=TEXT)
    d.text((110, 342), "Relay Module", font=font(82, bold=True), fill=TEXT)
    d.text((114, 438), "Approach to enable. Leave to release.", font=font(36), fill=MUTED)

    rounded_card(base, (1045, 245, 1490, 455), radius=42, fill="#E8F7F7", outline="#A9D8DA", width=4)
    d.rounded_rectangle((1092, 286, 1443, 374), radius=36, fill=DEEP)
    text_centered(d, (1092, 286, 1443, 374), "5 PCS SET", font(52, bold=True), WHITE)
    text_centered(d, (1092, 374, 1443, 430), "USD 99 / SET", font(31, bold=True), DEEP_2)

    rounded_card(base, (105, 520, 1495, 1038), radius=42, fill=WHITE, outline=LINE, width=3)
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    sx = 150 + (1300 - product_rgba.width) // 2
    sy = 600
    shadow_layer = Image.new("RGBA", product_rgba.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    sd.rounded_rectangle((20, product_rgba.height - 42, product_rgba.width - 20, product_rgba.height - 8), radius=40, fill=(0, 45, 48, 42))
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(18))
    shadow.alpha_composite(shadow_layer, (sx + 8, sy + 28))
    base.alpha_composite(shadow)
    base.alpha_composite(product_rgba, (sx, sy))

    d.rounded_rectangle((1145, 870, 1408, 960), radius=34, fill="#FFF4D8", outline="#F0BE56", width=3)
    text_centered(d, (1145, 870, 1408, 930), "x5 INCLUDED", font(38, bold=True), "#9A5B00")
    text_centered(d, (1145, 925, 1408, 960), "sold as one pack", font(21, bold=True), "#9A5B00")

    chips = ["5-12V DC", "10A Relay", "NO/NC/COM", "Dry Contact"]
    x = 110
    for t in chips:
        used = chip(d, x, 1110, t)
        x += used + 24

    rounded_card(base, (105, 1252, 1495, 1440), radius=34, fill="#FFFFFF", outline=LINE, width=3, shadow=False)
    d.text((150, 1303), "Phone proximity trigger", font=font(36, bold=True), fill=DEEP_2)
    d.text((150, 1360), "WeChat mini-program setup | Configurable distance | Latching / pulse mode", font=font(30), fill=MUTED)
    d.rounded_rectangle((1172, 1303, 1445, 1378), radius=30, fill=TEAL)
    text_centered(d, (1172, 1303, 1445, 1378), "NO APP INSTALL", font(27, bold=True), TEXT)

    d.rectangle((0, 1514, W, H), fill=DEEP_2)
    text_centered(d, (0, 1514, W, H), "5 PCS PER SET  |  USD 99  |  Bluetooth relay control module", font(34, bold=True), WHITE)

    base.convert("RGB").save(output, quality=95)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    build(args.assets_dir, args.output)


if __name__ == "__main__":
    main()
