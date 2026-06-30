from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle


PAGE_W, PAGE_H = letter
MARGIN_X = 54
TOP_BAR_H = 48
TOTAL_PAGES = 6

NAVY = HexColor("#0F1923")
NAVY_2 = HexColor("#0D2236")
NAVY_3 = HexColor("#162030")
TEAL = HexColor("#00D4AA")
TEAL_DARK = HexColor("#00B894")
TEXT = HexColor("#17202A")
MUTED = HexColor("#647985")
LINE = HexColor("#D8E6EA")
SOFT = HexColor("#E8F7F7")
SOFT_2 = HexColor("#F3FAFA")
WHITE = colors.white
WARNING = HexColor("#B45309")


ASSET_NAMES = {
    "single": "brake_04.jpg",
    "front": "brake_04.jpg",
    "terminal": "brake_04.jpg",
    "side": "brake_03.jpg",
    "package": "brake_06.jpg",
}


OUTPUT_FILES = {
    "main": "rogersense-zdk01-elevator-brake-power-main.jpg",
    "terminal": "rogersense-zdk01-elevator-brake-power-terminal.jpg",
    "programming": "rogersense-zdk01-elevator-brake-power-programming.jpg",
    "mounting": "rogersense-zdk01-elevator-brake-power-mounting.jpg",
    "spec": "rogersense-zdk01-elevator-brake-power-controller-spec.pdf",
}


def pil_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def load_image(path: Path) -> Image.Image:
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def fit_cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    w, h = size
    src = img.copy()
    src_ratio = src.width / src.height
    dst_ratio = w / h
    if src_ratio > dst_ratio:
        new_w = int(src.height * dst_ratio)
        left = (src.width - new_w) // 2
        src = src.crop((left, 0, left + new_w, src.height))
    else:
        new_h = int(src.width / dst_ratio)
        top = (src.height - new_h) // 2
        src = src.crop((0, top, src.width, top + new_h))
    return src.resize(size, Image.Resampling.LANCZOS)


def fit_contain(img: Image.Image, size: tuple[int, int], bg: str = "white") -> Image.Image:
    out = Image.new("RGB", size, bg)
    work = img.copy()
    work.thumbnail(size, Image.Resampling.LANCZOS)
    out.paste(work, ((size[0] - work.width) // 2, (size[1] - work.height) // 2))
    return out


def rounded_paste(base: Image.Image, img: Image.Image, box: tuple[int, int, int, int], radius: int = 22):
    x, y, w, h = box
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, w, h), radius=radius, fill=255)
    base.paste(img, (x, y), mask)


def gradient(size: tuple[int, int]) -> Image.Image:
    w, h = size
    out = Image.new("RGB", size, "#0F1923")
    d = ImageDraw.Draw(out)
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(15 * (1 - t) + 13 * t)
        g = int(25 * (1 - t) + 34 * t)
        b = int(35 * (1 - t) + 54 * t)
        d.line((0, y, w, y), fill=(r, g, b))
    return out


def draw_text(draw: ImageDraw.ImageDraw, xy, text: str, size: int, fill: str, bold: bool = False):
    draw.text(xy, text, font=pil_font(size, bold), fill=fill)


def text_size(text: str, size: int, bold: bool = False) -> tuple[int, int]:
    font = pil_font(size, bold)
    box = font.getbbox(text)
    return box[2] - box[0], box[3] - box[1]


def wrap_text(text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        test = word if not cur else f"{cur} {word}"
        if font.getlength(test) <= max_width:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def draw_wrapped_pil(draw: ImageDraw.ImageDraw, xy, text: str, size: int, fill: str, max_width: int, bold: bool = False, leading: int | None = None):
    font = pil_font(size, bold)
    x, y = xy
    for line in wrap_text(text, font, max_width):
        draw.text((x, y), line, font=font, fill=fill)
        y += leading or int(size * 1.35)
    return y


def save_jpeg(img: Image.Image, path: Path):
    img.convert("RGB").save(path, quality=92, optimize=True)


def make_main_image(assets: dict[str, Path], out: Path):
    img = gradient((1600, 1200))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((70, 70, 1530, 1130), radius=36, outline="#1E2D3D", width=2)
    d.rectangle((70, 70, 1530, 156), fill="#0D2236")
    d.line((70, 156, 1530, 156), fill="#00D4AA", width=3)
    draw_text(d, (110, 102), "ROGERSENSE", 30, "#F0F4F8", True)
    draw_text(d, (1280, 108), "Industrial Control", 24, "#8BA3B8")

    draw_text(d, (110, 245), "ZDK-01 Elevator", 62, "#F0F4F8", True)
    draw_text(d, (110, 318), "Brake Power Controller", 62, "#F0F4F8", True)
    y = draw_wrapped_pil(
        d,
        (112, 416),
        "Adjustable brake-coil controller for elevator brake power applications. AC 220 V input with DC 20-220 V adjustable output.",
        30,
        "#8BA3B8",
        610,
        leading=42,
    )

    cards = [
        ("AC 220 V", "Input supply"),
        ("DC 20-220 V", "Adjustable output"),
        ("10 A", "Output current"),
        ("H / L / S", "Programmable timing"),
    ]
    for i, (title, sub) in enumerate(cards):
        x = 110 + (i % 2) * 285
        cy = y + 54 + (i // 2) * 130
        d.rounded_rectangle((x, cy, x + 245, cy + 96), radius=18, fill="#0D2236", outline="#1E2D3D", width=2)
        draw_text(d, (x + 22, cy + 22), title, 30, "#00D4AA", True)
        draw_text(d, (x + 22, cy + 58), sub, 21, "#8BA3B8")

    product_tile = Image.new("RGB", (650, 650), "white")
    product = fit_cover(load_image(assets["single"]), (610, 610))
    product_tile.paste(product, (20, 20))
    rounded_paste(img, product_tile, (875, 260, 650, 650), radius=34)
    d.rounded_rectangle((875, 260, 1525, 910), radius=34, outline="#1E2D3D", width=2)

    d.rounded_rectangle((1000, 940, 1525, 1038), radius=20, fill="#00D4AA")
    draw_text(d, (1058, 970), "Sold individually - 1 controller per order", 23, "#0F1923", True)
    save_jpeg(img, out)


def make_terminal_image(assets: dict[str, Path], out: Path):
    img = gradient((1600, 1200))
    d = ImageDraw.Draw(img)
    draw_text(d, (90, 80), "Terminal Layout", 56, "#F0F4F8", True)
    draw_wrapped_pil(d, (92, 150), "AC input terminals and brake-coil output are separated on the same block. Confirm wiring before energizing.", 28, "#8BA3B8", 700, leading=40)

    photo = fit_cover(load_image(assets["terminal"]), (820, 820))
    rounded_paste(img, photo, (90, 290, 820, 820), radius=28)
    d.rounded_rectangle((90, 290, 910, 1110), radius=28, outline="#1E2D3D", width=2)

    labels = [
        ("L", "AC 220 V line", 1030, 330),
        ("N", "AC 220 V neutral", 1030, 455),
        ("B+", "Brake coil positive", 1030, 580),
        ("B-", "Brake coil negative", 1030, 705),
    ]
    for code, desc, x, y in labels:
        d.rounded_rectangle((x, y, 1460, y + 88), radius=16, fill="#0D2236", outline="#1E2D3D", width=2)
        d.rounded_rectangle((x + 18, y + 18, x + 88, y + 70), radius=10, fill="#00D4AA")
        draw_text(d, (x + 38, y + 27), code, 24, "#0F1923", True)
        draw_text(d, (x + 112, y + 23), desc, 28, "#F0F4F8", True)
        draw_text(d, (x + 112, y + 55), "Verify polarity and input side", 18, "#8BA3B8")

    d.rounded_rectangle((1028, 870, 1460, 1015), radius=18, fill="#162030", outline="#1E2D3D", width=2)
    draw_text(d, (1060, 900), "Important", 28, "#00D4AA", True)
    draw_wrapped_pil(d, (1060, 944), "Do not confuse L/N input with B+/B- output. Wiring errors can damage the controller.", 24, "#F0F4F8", 360, leading=32)
    save_jpeg(img, out)


def make_programming_image(out: Path):
    img = gradient((1600, 1200))
    d = ImageDraw.Draw(img)
    draw_text(d, (90, 80), "H / L / S Setup", 56, "#F0F4F8", True)
    draw_wrapped_pil(d, (92, 150), "Use SET to step through excitation voltage, holding voltage, and the delay from excitation to holding output.", 28, "#8BA3B8", 980, leading=40)

    steps = [
        ("1", "Connect load", "Power the controller with a load connected before adjusting voltage."),
        ("2", "H flashes", "Press SET once and adjust the excitation voltage."),
        ("3", "L flashes", "Press SET again and adjust the holding voltage."),
        ("4", "S flashes", "Press SET again and adjust the transfer delay."),
        ("5", "Save", "Press SET again to save and run one test cycle."),
    ]
    for i, (num, title, body) in enumerate(steps):
        y = 288 + i * 150
        d.rounded_rectangle((110, y, 1490, y + 112), radius=20, fill="#0D2236", outline="#1E2D3D", width=2)
        d.ellipse((142, y + 31, 212, y + 101), fill="#00D4AA")
        draw_text(d, (168, y + 48), num, 32, "#0F1923", True)
        draw_text(d, (246, y + 26), title, 34, "#F0F4F8", True)
        draw_wrapped_pil(d, (246, y + 66), body, 24, "#8BA3B8", 980, leading=32)
    save_jpeg(img, out)


def make_mounting_image(assets: dict[str, Path], out: Path):
    img = gradient((1600, 1200))
    d = ImageDraw.Draw(img)
    draw_text(d, (90, 80), "Installation Reference", 56, "#F0F4F8", True)
    draw_wrapped_pil(d, (92, 150), "Compact controller housing with mounting ears for panel or cabinet installation.", 28, "#8BA3B8", 720, leading=40)

    side = fit_cover(load_image(assets["side"]), (650, 820))
    front = fit_cover(load_image(assets["front"]), (650, 820))
    rounded_paste(img, side, (100, 285, 650, 820), radius=28)
    rounded_paste(img, front, (850, 285, 650, 820), radius=28)
    d.rounded_rectangle((100, 285, 750, 1105), radius=28, outline="#1E2D3D", width=2)
    d.rounded_rectangle((850, 285, 1500, 1105), radius=28, outline="#1E2D3D", width=2)
    d.rounded_rectangle((120, 985, 490, 1062), radius=16, fill="#0F1923")
    d.rounded_rectangle((870, 985, 1270, 1062), radius=16, fill="#0F1923")
    draw_text(d, (145, 1008), "Side profile and mounting ears", 24, "#F0F4F8", True)
    draw_text(d, (895, 1008), "Front controls and display", 24, "#F0F4F8", True)
    save_jpeg(img, out)


def pstyle(size=9, color=TEXT, leading=None, bold=False, align=TA_LEFT):
    return ParagraphStyle(
        name=f"s-{size}-{bold}-{align}",
        fontName="Helvetica-Bold" if bold else "Helvetica",
        fontSize=size,
        leading=leading or size * 1.35,
        textColor=color,
        alignment=align,
        spaceAfter=0,
        spaceBefore=0,
    )


def para(c, text, x, y, w, size=9, color=TEXT, leading=None, bold=False):
    flow = Paragraph(text, pstyle(size=size, color=color, leading=leading, bold=bold))
    _, h = flow.wrapOn(c, w, 500)
    flow.drawOn(c, x, y - h)
    return h


def rounded_rect(c, x, y, w, h, fill, stroke=LINE, r=7, sw=0.7):
    c.setLineWidth(sw)
    c.setStrokeColor(stroke)
    c.setFillColor(fill)
    c.roundRect(x, y, w, h, r, stroke=1, fill=1)


def image_within(c, path, x, y, w, h):
    img = ImageReader(str(path))
    iw, ih = img.getSize()
    scale = min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    c.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh, mask="auto")


def header(c, title, page_no):
    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - TOP_BAR_H, PAGE_W, TOP_BAR_H, stroke=0, fill=1)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(MARGIN_X, PAGE_H - 29, "ROGERSENSE")
    c.setFont("Helvetica", 8)
    c.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 29, "www.rogersense.com")
    c.setStrokeColor(TEAL)
    c.setLineWidth(1.4)
    c.line(0, PAGE_H - TOP_BAR_H, PAGE_W, PAGE_H - TOP_BAR_H)
    c.setFont("Helvetica", 7.5)
    c.setFillColor(MUTED)
    c.drawString(MARGIN_X, 24, title)
    c.drawRightString(PAGE_W - MARGIN_X, 24, f"{page_no} / {TOTAL_PAGES}")


def section_title(c, eyebrow, title, x=MARGIN_X, y=712):
    c.setFillColor(TEAL_DARK)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x, y, eyebrow.upper())
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(x, y - 31, title)
    c.setStrokeColor(TEAL)
    c.setLineWidth(2)
    c.line(x, y - 42, x + 36, y - 42)


def bullet_list(c, items, x, y, w, size=8.2, gap=5, color=TEXT):
    cur = y
    for item in items:
        c.setFillColor(TEAL_DARK)
        c.circle(x + 4, cur - 4, 2.2, stroke=0, fill=1)
        h = para(c, item, x + 13, cur, w - 13, size=size, color=color, leading=size * 1.35)
        cur -= h + gap
    return y - cur


def table_draw(c, data, x, y, col_widths, font_size=7.7):
    body = pstyle(size=font_size, color=TEXT, leading=font_size * 1.32)
    bold = pstyle(size=font_size, color=NAVY_2, leading=font_size * 1.32, bold=True)
    rows = [[Paragraph(str(k), bold), Paragraph(str(v), body)] for k, v in data]
    t = Table(rows, colWidths=col_widths)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("BACKGROUND", (0, 0), (0, -1), SOFT_2),
    ]))
    _, h = t.wrapOn(c, sum(col_widths), 700)
    t.drawOn(c, x, y - h)
    return h


def note_box(c, x, y, w, h, title, body, fill=HexColor("#FFF8ED"), stroke=HexColor("#F3C982")):
    rounded_rect(c, x, y, w, h, fill, stroke=stroke, r=6)
    c.setFillColor(WARNING)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x + 12, y + h - 18, title)
    para(c, body, x + 12, y + h - 34, w - 24, size=7.6, color=TEXT, leading=10.5)


def draw_cover(c, img_path: Path):
    c.setFillColor(NAVY)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(NAVY_2)
    c.rect(0, PAGE_H - 70, PAGE_W, 70, stroke=0, fill=1)
    c.setStrokeColor(TEAL)
    c.setLineWidth(2)
    c.line(0, PAGE_H - 70, PAGE_W, PAGE_H - 70)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN_X, PAGE_H - 43, "ROGERSENSE")
    c.setFont("Helvetica", 8)
    c.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 43, "www.rogersense.com")

    c.setFillColor(TEAL)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(MARGIN_X, 612, "PRODUCT SPECIFICATION")
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(MARGIN_X, 558, "ZDK-01 Elevator")
    c.drawString(MARGIN_X, 520, "Brake Power Controller")
    c.setFillColor(HexColor("#8BA3B8"))
    c.setFont("Helvetica", 13)
    c.drawString(MARGIN_X, 492, "Adjustable brake-coil power controller")

    rounded_rect(c, 335, 318, 210, 190, WHITE, stroke=HexColor("#1E2D3D"), r=10)
    image_within(c, img_path, 350, 335, 180, 155)

    rows = [
        ("Input", "AC 220 V"),
        ("Output voltage", "DC 20-220 V adjustable"),
        ("Output current", "10 A"),
        ("Controls", "SET, Up, Down; H / L / S parameter modes"),
        ("Sales unit", "1 controller per order"),
        ("Use case", "Elevator brake / electromagnetic brake coil control"),
    ]
    rounded_rect(c, MARGIN_X, 88, 460, 192, WHITE, stroke=HexColor("#1E2D3D"), r=8)
    table_draw(c, rows, MARGIN_X, 278, [130, 330], font_size=7.7)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7.5)
    c.drawRightString(PAGE_W - MARGIN_X, 24, "1 / 6")


def page_overview(c, img_path: Path):
    header(c, "ZDK-01 Elevator Brake Power Controller", 2)
    section_title(c, "Overview", "Adjustable brake power control")
    para(
        c,
        "The ZDK-01 Elevator Brake Power Controller is an AC-input brake power module for elevator brake and electromagnetic brake coil applications. It provides adjustable DC output and separate excitation / holding parameters so the brake coil can be energized strongly, then held at a lower voltage after the configured transfer delay.",
        MARGIN_X,
        632,
        300,
        size=9.2,
        leading=12.8,
    )
    image_within(c, img_path, 382, 490, 160, 170)
    cards = [
        ("AC 220 V input", "Standard line-input brake power wiring."),
        ("DC 20-220 V output", "Adjustable output range for brake coil tuning."),
        ("10 A output current", "Controller output current reference from supplier details."),
        ("H / L / S setup", "Excitation voltage, holding voltage, and transfer delay."),
    ]
    for i, (title, body) in enumerate(cards):
        x = MARGIN_X + (i % 2) * 255
        y = 392 - (i // 2) * 104
        rounded_rect(c, x, y, 236, 78, WHITE, stroke=LINE, r=7)
        c.setFillColor(TEAL)
        c.circle(x + 16, y + 53, 3, stroke=0, fill=1)
        c.setFillColor(NAVY_2)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(x + 26, y + 49, title)
        para(c, body, x + 26, y + 35, 195, size=7.4, color=MUTED, leading=9.8)
    note_box(
        c,
        MARGIN_X,
        120,
        500,
        78,
        "Application note",
        "This product is an integration component for qualified elevator or industrial-control personnel. It is not a substitute for required safety circuits, certified emergency systems, or code-required inspection procedures.",
    )


def page_specs(c):
    header(c, "Technical Specifications", 3)
    section_title(c, "Specifications", "Electrical and interface data")
    rows = [
        ("Product name", "Elevator brake power controller"),
        ("Model", "ZDK-01"),
        ("Replacement note", "Listing references EMK-BZ127AJ-class replacement compatibility; verify exact wiring and parameters before installation."),
        ("Input supply", "AC 220 V input"),
        ("Input terminals", "L and N"),
        ("Output terminals", "B+ and B- to brake coil"),
        ("Output voltage", "DC 20-220 V adjustable"),
        ("Output current", "10 A reference from supplied listing image"),
        ("Control parameters", "H: excitation voltage; L: holding voltage; S: transfer interval from excitation to holding voltage"),
        ("Controls", "SET key for mode selection and confirmation; Up / Down keys for parameter adjustment"),
        ("Example setup", "Supplier manual example: H = 110 V, L = 80 V, then set S delay and save"),
        ("Load during adjustment", "Use a connected load while adjusting output. Manual suggests a 100 W lamp as a temporary load before connecting the brake coil."),
        ("Document source", "Based on supplied product images and ZDK-01 Chinese user manual, 2024-11 edition."),
    ]
    table_draw(c, rows, MARGIN_X, 642, [150, 350], font_size=7.5)


def page_wiring(c):
    header(c, "Wiring and Terminals", 4)
    section_title(c, "Wiring", "Terminal definition")
    rounded_rect(c, MARGIN_X, 440, 500, 170, WHITE, stroke=LINE, r=8)
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(NAVY_2)
    c.drawString(MARGIN_X + 16, 585, "Terminal map")
    x0, y0 = MARGIN_X + 48, 520
    terms = [("1", "B-", "Brake coil negative"), ("2", "B+", "Brake coil positive"), ("3", "N", "AC 220 V neutral"), ("4", "L", "AC 220 V line")]
    for i, (num, code, desc) in enumerate(terms):
        x = x0 + i * 112
        c.setFillColor(TEAL if i < 2 else NAVY_2)
        c.roundRect(x, y0, 72, 42, 8, stroke=0, fill=1)
        c.setFillColor(NAVY if i < 2 else WHITE)
        c.setFont("Helvetica-Bold", 12)
        c.drawCentredString(x + 36, y0 + 25, code)
        c.setFont("Helvetica", 6.8)
        c.drawCentredString(x + 36, y0 + 11, f"Terminal {num}")
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 7.1)
        c.drawCentredString(x + 36, y0 - 14, desc)

    rows = [
        ("Before wiring", "Confirm input power is fully disconnected."),
        ("L / N", "Connect AC 220 V input. Do not touch terminals while energized."),
        ("B+ / B-", "Connect to the brake coil after output parameters are adjusted with a temporary load."),
        ("Do not mix terminals", "Confusing input L/N and output B+/B- can damage the controller."),
        ("Debris control", "Prevent screws, washers, wire strands, and other metal objects from entering the controller."),
    ]
    table_draw(c, rows, MARGIN_X, 365, [130, 370], font_size=7.8)
    note_box(
        c,
        MARGIN_X,
        100,
        500,
        86,
        "Qualified personnel only",
        "Debugging, repair, inspection, and installation should be performed only by professionally qualified personnel. Always follow local elevator, electrical, and workplace-safety rules.",
    )


def page_operation(c):
    header(c, "Parameter Operation", 5)
    section_title(c, "Operation", "Basic H / L / S setup sequence")
    steps = [
        ("1", "Connect power and load", "Connect AC input and a suitable load. The manual suggests using a 100 W lamp during adjustment."),
        ("2", "Set H excitation voltage", "Press SET once until H flashes, then use Up / Down to adjust the required excitation voltage."),
        ("3", "Set L holding voltage", "Press SET again until L flashes, then adjust the required holding voltage."),
        ("4", "Set S transfer interval", "Press SET again until S flashes, then adjust the delay from excitation voltage to holding voltage."),
        ("5", "Save and test", "Press SET again. The controller saves the parameters and automatically runs one cycle using the saved settings."),
    ]
    y = 600
    for num, title, body in steps:
        rounded_rect(c, MARGIN_X, y - 58, 500, 58, WHITE, stroke=LINE, r=7)
        c.setFillColor(TEAL)
        c.circle(MARGIN_X + 22, y - 29, 13, stroke=0, fill=1)
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 10)
        c.drawCentredString(MARGIN_X + 22, y - 32.5, num)
        c.setFillColor(NAVY_2)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(MARGIN_X + 45, y - 20, title)
        para(c, body, MARGIN_X + 45, y - 34, 445, size=7.3, color=MUTED, leading=9.7)
        y -= 76
    note_box(
        c,
        MARGIN_X,
        105,
        500,
        74,
        "Adjustment caution",
        "Set and verify excitation voltage and holding voltage before connecting the final brake coil. Incorrect voltage or timing can cause overheating, weak braking release, or equipment faults.",
        fill=HexColor("#EEF7FF"),
        stroke=HexColor("#9CC8E7"),
    )


def page_notes(c):
    header(c, "Safety and Ordering Notes", 6)
    section_title(c, "Notes", "Integration and compliance")
    bullet_list(
        c,
        [
            "<b>Professional installation required.</b> Elevator brake circuits are safety-critical. This controller must be selected, wired, configured, and inspected by qualified personnel.",
            "Disconnect input power completely before wiring, inspection, or maintenance.",
            "Verify brake-coil voltage, current, timing, heat rise, and release/hold behavior in the actual installation before service use.",
            "Do not use this document as a market certification, safety approval, or elevator-code approval.",
            "Final compliance, labeling, user instructions, inspection, and local approval remain the responsibility of the system integrator or installer.",
        ],
        MARGIN_X,
        636,
        500,
        size=8.0,
        gap=8,
    )
    rows = [
        ("Ordering item", "ZDK-01 Elevator Brake Power Controller"),
        ("Sales unit", "One controller per order quantity"),
        ("Online price", "USD 149.00"),
        ("Included resources", "English product specification PDF; original product images available on request"),
        ("Support", "Rogersense can help review wiring, documentation, and product localization requirements."),
        ("Website", "www.rogersense.com"),
    ]
    table_draw(c, rows, MARGIN_X, 332, [130, 370], font_size=7.7)
    note_box(
        c,
        MARGIN_X,
        100,
        500,
        86,
        "Preliminary data note",
        "This English specification is redrawn from supplied Chinese product references and user manual text. Confirm final production batch, supplier revision, and installation requirements before regulated-market shipment.",
        fill=WHITE,
        stroke=LINE,
    )


def build_pdf(image_paths: dict[str, Path], output: Path):
    c = canvas.Canvas(str(output), pagesize=letter)
    c.setTitle("Rogersense ZDK-01 Elevator Brake Power Controller Product Specification")
    c.setAuthor("Rogersense")
    draw_cover(c, image_paths["main"])
    c.showPage()
    page_overview(c, image_paths["main"])
    c.showPage()
    page_specs(c)
    c.showPage()
    page_wiring(c)
    c.showPage()
    page_operation(c)
    c.showPage()
    page_notes(c)
    c.save()


def build_assets(assets_dir: Path, output_dir: Path) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    assets = {key: assets_dir / name for key, name in ASSET_NAMES.items()}
    missing = [str(path) for path in assets.values() if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing source assets: " + ", ".join(missing))

    outputs = {key: output_dir / name for key, name in OUTPUT_FILES.items()}
    make_main_image(assets, outputs["main"])
    make_terminal_image(assets, outputs["terminal"])
    make_programming_image(outputs["programming"])
    make_mounting_image(assets, outputs["mounting"])
    build_pdf(outputs, outputs["spec"])
    return outputs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets-dir", type=Path, default=Path("/private/tmp/rogersense-brake-assets"))
    parser.add_argument("--output-dir", type=Path, default=Path("product-specs"))
    args = parser.parse_args()
    outputs = build_assets(args.assets_dir, args.output_dir)
    for path in outputs.values():
        print(path)


if __name__ == "__main__":
    main()
