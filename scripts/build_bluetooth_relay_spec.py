from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle


PAGE_W, PAGE_H = letter
MARGIN_X = 54
TOP_BAR_H = 46
TOTAL_PAGES = 8

NAVY = HexColor("#111827")
DEEP = HexColor("#005F63")
DEEP_2 = HexColor("#004C50")
TEAL = HexColor("#00AFA5")
TEAL_DARK = HexColor("#007B78")
MINT = HexColor("#E8F7F7")
MINT_2 = HexColor("#F3FAFA")
LINE = HexColor("#D8E6EA")
TEXT = HexColor("#17202A")
MUTED = HexColor("#647985")
LIGHT_TEXT = HexColor("#F5FBFC")
WARNING = HexColor("#B45309")
WHITE = colors.white


def pstyle(size=9, color=TEXT, leading=None, bold=False, align=TA_LEFT):
    return ParagraphStyle(
        name=f"s-{size}-{color}-{bold}-{align}",
        fontName="Helvetica-Bold" if bold else "Helvetica",
        fontSize=size,
        leading=leading or size * 1.35,
        textColor=color,
        alignment=align,
        spaceAfter=0,
        spaceBefore=0,
    )


def para(c, text, x, y, w, size=9, color=TEXT, leading=None, bold=False):
    style = pstyle(size=size, color=color, leading=leading, bold=bold)
    flow = Paragraph(text, style)
    _, h = flow.wrapOn(c, w, 500)
    flow.drawOn(c, x, y - h)
    return h


def draw_wrapped(c, text, x, y, w, size=9, color=TEXT, leading=None, bold=False):
    return para(c, text, x, y, w, size=size, color=color, leading=leading, bold=bold)


def image_within(c, path, x, y, w, h, preserve=True):
    img = ImageReader(str(path))
    iw, ih = img.getSize()
    if preserve:
        scale = min(w / iw, h / ih)
        dw, dh = iw * scale, ih * scale
        c.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh, mask="auto")
    else:
        c.drawImage(img, x, y, w, h, mask="auto")


def rounded_rect(c, x, y, w, h, fill, stroke=LINE, r=7, sw=0.7):
    c.setLineWidth(sw)
    c.setStrokeColor(stroke)
    c.setFillColor(fill)
    c.roundRect(x, y, w, h, r, stroke=1, fill=1)


def header(c, page_title, page_no):
    c.setFillColor(DEEP)
    c.rect(0, PAGE_H - TOP_BAR_H, PAGE_W, TOP_BAR_H, stroke=0, fill=1)
    c.setFillColor(LIGHT_TEXT)
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(MARGIN_X, PAGE_H - 27, "ROGERSENSE")
    c.setFont("Helvetica", 8)
    c.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 27, "www.rogersense.com")
    c.setStrokeColor(TEAL)
    c.setLineWidth(1.2)
    c.line(0, PAGE_H - TOP_BAR_H, PAGE_W, PAGE_H - TOP_BAR_H)
    c.setFont("Helvetica", 7.5)
    c.setFillColor(MUTED)
    c.drawString(MARGIN_X, 24, page_title)
    c.drawRightString(PAGE_W - MARGIN_X, 24, f"{page_no} / {TOTAL_PAGES}")


def section_title(c, eyebrow, title, x=MARGIN_X, y=715):
    c.setFillColor(TEAL_DARK)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x, y, eyebrow.upper())
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(x, y - 31, title)
    c.setStrokeColor(TEAL)
    c.setLineWidth(2)
    c.line(x, y - 42, x + 36, y - 42)


def card(c, x, y, w, h, title, body, accent=DEEP):
    rounded_rect(c, x, y, w, h, MINT, stroke=LINE, r=5)
    c.setFillColor(accent)
    c.setFont("Helvetica-Bold", 17)
    c.drawCentredString(x + w / 2, y + h - 28, title)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 7.4)
    c.drawCentredString(x + w / 2, y + 14, body)


def feature_card(c, x, y, w, h, title, body):
    rounded_rect(c, x, y, w, h, WHITE, stroke=LINE, r=7)
    c.setFillColor(TEAL)
    c.circle(x + 15, y + h - 17, 3, stroke=0, fill=1)
    c.setFillColor(DEEP_2)
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(x + 25, y + h - 22, title)
    draw_wrapped(c, body, x + 25, y + h - 37, w - 38, size=7.8, color=MUTED, leading=10.2)


def note_box(c, x, y, w, h, title, body, fill=HexColor("#FFF8ED"), stroke=HexColor("#F3C982")):
    rounded_rect(c, x, y, w, h, fill, stroke=stroke, r=6)
    c.setFillColor(WARNING)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x + 12, y + h - 18, title)
    draw_wrapped(c, body, x + 12, y + h - 34, w - 24, size=7.6, color=TEXT, leading=10.5)


def bullet_list(c, items, x, y, w, size=8.2, gap=5, color=TEXT):
    cur = y
    for item in items:
        c.setFillColor(TEAL_DARK)
        c.circle(x + 4, cur - 4, 2.2, stroke=0, fill=1)
        h = draw_wrapped(c, item, x + 13, cur, w - 13, size=size, color=color, leading=size * 1.35)
        cur -= h + gap
    return y - cur


def table_draw(c, data, x, y, col_widths, font_size=7.7, header=False):
    body_style = pstyle(size=font_size, color=TEXT, leading=font_size * 1.32)
    body_bold = pstyle(size=font_size, color=DEEP_2, leading=font_size * 1.32, bold=True)
    rows = []
    for i, row in enumerate(data):
        rows.append([Paragraph(str(row[0]), body_bold), Paragraph(str(row[1]), body_style)])
    t = Table(rows, colWidths=col_widths)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("BACKGROUND", (0, 0), (0, -1), MINT_2),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), DEEP))
        style.append(("TEXTCOLOR", (0, 0), (-1, 0), WHITE))
    t.setStyle(TableStyle(style))
    _, h = t.wrapOn(c, sum(col_widths), 600)
    t.drawOn(c, x, y - h)
    return h


def find_image(assets_dir: Path, token: str) -> Path:
    matches = [p for p in assets_dir.rglob("*") if token in p.name and p.suffix.lower() in {".jpg", ".jpeg", ".png"}]
    if not matches:
        raise FileNotFoundError(f"Missing image token: {token}")
    return matches[0]


def find_package_image(assets_dir: Path) -> Path:
    candidates = []
    for p in assets_dir.rglob("*"):
        if p.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        try:
            with Image.open(p) as im:
                if im.size == (800, 1066):
                    candidates.append(p)
        except Exception:
            pass
    if not candidates:
        raise FileNotFoundError("Missing 800x1066 packaging image")
    return candidates[0]


def prepare_assets(assets_dir: Path, work_dir: Path) -> dict[str, Path]:
    work_dir.mkdir(parents=True, exist_ok=True)

    hero_src = find_image(assets_dir, "20260510154315_340_2")
    pair_src = find_image(assets_dir, "20260510164003_343_2.png")
    package_src = find_package_image(assets_dir)

    hero = Image.open(hero_src).convert("RGB")
    hero_crop = hero.crop((35, 310, 1370, 950))
    hero_crop = ImageOps.expand(hero_crop, border=18, fill="white")
    hero_out = work_dir / "hero-module.jpg"
    hero_crop.save(hero_out, quality=94)

    pair = Image.open(pair_src).convert("RGB")
    pair_crop = pair.crop((250, 590, 1480, 2115))
    pair_crop = ImageOps.expand(pair_crop, border=24, fill="white")
    pair_out = work_dir / "module-front-back.jpg"
    pair_crop.save(pair_out, quality=94)

    pack = Image.open(package_src).convert("RGB")
    pack_crop = pack.crop((32, 68, 760, 1035))
    pack_out = work_dir / "packaging.jpg"
    pack_crop.save(pack_out, quality=92)

    return {"hero": hero_out, "pair": pair_out, "package": pack_out}


def draw_cover(c, imgs):
    c.setFillColor(MINT_2)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(DEEP)
    c.rect(0, PAGE_H - 68, PAGE_W, 68, stroke=0, fill=1)
    c.setFillColor(LIGHT_TEXT)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN_X, PAGE_H - 42, "ROGERSENSE")
    c.setFont("Helvetica", 8)
    c.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 42, "www.rogersense.com")
    c.setStrokeColor(TEAL)
    c.setLineWidth(2)
    c.line(0, PAGE_H - 68, PAGE_W, PAGE_H - 68)

    x = MARGIN_X
    top = 600
    c.setFillColor(TEAL_DARK)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x, top, "ROGERSENSE | www.rogersense.com")
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 32)
    c.drawString(x, top - 44, "Bluetooth Proximity")
    c.drawString(x, top - 81, "Relay Module")
    c.setFillColor(TEXT)
    c.setFont("Helvetica", 14)
    c.drawString(x, top - 111, "Product Specification & Integration Guide")

    card_w, card_h = 145, 58
    card(c, x, top - 205, card_w, card_h, "5-12 VDC", "Wide input supply")
    card(c, x + card_w + 5, top - 205, card_w, card_h, "10 A", "Relay contact rating")
    card(c, x, top - 268, card_w, card_h, "NO/NC/COM", "Dry-contact output")
    card(c, x + card_w + 5, top - 268, card_w, card_h, "62 x 20 x 17", "Module size, mm")

    img_x, img_y, img_w, img_h = 325, 300, 230, 230
    rounded_rect(c, img_x, img_y, img_w, img_h, WHITE, stroke=LINE, r=8)
    c.setFillColor(DEEP_2)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(img_x + 13, img_y + img_h - 18, "Product reference image")
    image_within(c, imgs["hero"], img_x + 10, img_y + 22, img_w - 20, img_h - 48)
    c.setFont("Helvetica", 6.8)
    c.setFillColor(MUTED)
    c.drawString(img_x + 13, img_y + 13, "English datasheet redrawn from supplied product references")

    rows = [
        ("Document", "English Product Specification"),
        ("Product", "Bluetooth Proximity Relay Module"),
        ("Revision", "1.0"),
        ("Release Date", "June 6, 2026"),
        ("Document Status", "Preliminary customer download edition"),
    ]
    table_draw(c, rows, MARGIN_X, 252, [145, 315], font_size=7.7)
    note_box(
        c,
        MARGIN_X,
        75,
        460,
        66,
        "Preliminary data note",
        "Electrical and mechanical data are based on supplied product images and listing text. Final production orders should confirm certification files, firmware revision, and market-specific compliance documents before shipment.",
        fill=WHITE,
        stroke=LINE,
    )
    c.setFont("Helvetica", 7.5)
    c.setFillColor(MUTED)
    c.drawRightString(PAGE_W - MARGIN_X, 24, f"1 / {TOTAL_PAGES}")


def page_overview(c, imgs):
    header(c, "Bluetooth Proximity Relay Module", 2)
    section_title(c, "Product Overview", "Compact Bluetooth proximity control")
    copy = (
        "The Bluetooth Proximity Relay Module is a compact dry-contact control board for "
        "near-field enable, unlock, and switching applications. A paired phone can act as "
        "the proximity key: when the configured Bluetooth signal condition is met, the relay "
        "can close or pulse; when the phone leaves the configured range, the relay can release."
    )
    draw_wrapped(c, copy, MARGIN_X, 635, 300, size=9.4, color=TEXT, leading=13)
    image_within(c, imgs["pair"], 392, 500, 150, 185)

    feature_card(c, MARGIN_X, 455, 160, 92, "Bluetooth proximity trigger", "Uses phone Bluetooth signal strength for approach / leave control logic.")
    feature_card(c, 226, 455, 160, 92, "Relay dry contact", "SPDT relay output with NO, COM, and NC contacts for external loads.")
    feature_card(c, 398, 455, 160, 92, "No native app install", "Configuration through a WeChat mini-program on iOS or Android.")

    feature_card(c, MARGIN_X, 335, 160, 92, "Configurable behavior", "Name, password, sensing distance, thresholds, and operating mode can be adjusted.")
    feature_card(c, 226, 335, 160, 92, "OEM friendly", "Suitable for learning, prototyping, and secondary development with custom options.")
    feature_card(c, 398, 335, 160, 92, "Multi-phone pairing", "Reference listing states support for up to 50 paired phones.")

    note_box(
        c,
        MARGIN_X,
        175,
        504,
        82,
        "Use-positioning note",
        "This module provides convenience control based on Bluetooth proximity. It should not be used as the only security, life-safety, or functional-safety mechanism unless the complete end product is engineered and certified for that use.",
    )


def page_specs(c):
    header(c, "Technical Specifications", 3)
    section_title(c, "Specifications", "Electrical, wireless, and mechanical data")
    rows = [
        ("Product type", "Bluetooth proximity relay module / dry-contact switching controller"),
        ("Supply input", "5-12 VDC input range; nominal 12 VDC wiring reference shown in supplier materials"),
        ("Input terminal", "IN+ and IN- low-voltage DC input"),
        ("Input current reference", "DC input terminal reference: 5-12 V / 100 mA"),
        ("Standby current", "Approx. 10 mA, based on supplier listing text"),
        ("Operating power", "Not greater than 0.5 W, based on supplier listing text"),
        ("Input protection", "Reverse-polarity protection indicated in supplier listing text"),
        ("Relay output", "Single SPDT dry contact: NO/ON, COM, NC"),
        ("Relay contact rating", "10 A / 250 VAC max reference; relay package also indicates 10 A ratings at 125 VAC and low-voltage DC loads"),
        ("Contact behavior", "Output is a dry-contact switch. The load circuit supplies its own voltage."),
        ("Bluetooth identifier", "Default Bluetooth name begins with NBH-"),
        ("Default pairing password", "123456; password is configurable in the mini-program"),
        ("Configuration method", "WeChat mini-program; iOS and Android via WeChat, no native app installation"),
        ("Supported users", "Up to 50 paired phones, based on supplier listing text"),
        ("Operating modes", "Latching proximity mode and momentary / pulse mode"),
        ("Configurable items", "Device name, password, sensing distance, unlock threshold, lock threshold, pulse / latching behavior"),
        ("Mechanical size", "62 x 20 x 17 mm"),
        ("Board marking", "Ble_Relay_V1.3 shown on supplied PCB photos; product package references the newer module version"),
    ]
    table_draw(c, rows, MARGIN_X, 645, [160, 340], font_size=7.2)


def draw_terminal_map(c):
    x, y, w, h = MARGIN_X, 445, 500, 155
    rounded_rect(c, x, y, w, h, WHITE, stroke=LINE, r=8)
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(DEEP_2)
    c.drawString(x + 16, y + h - 22, "Simplified terminal map")
    bx, by, bw, bh = x + 70, y + 42, 360, 70
    rounded_rect(c, bx, by, bw, bh, MINT_2, stroke=HexColor("#B9D8DC"), r=5)
    c.setFillColor(DEEP_2)
    c.setFont("Helvetica-Bold", 8)
    c.drawCentredString(bx + bw / 2, by + bh - 13, "Bluetooth relay board")

    c.setStrokeColor(DEEP_2)
    c.setLineWidth(1.2)
    for i, label in enumerate(["IN-", "IN+"]):
        tx = bx - 45
        ty = by + 18 + i * 26
        c.line(tx + 22, ty + 5, bx, ty + 5)
        c.setFillColor(WHITE)
        c.setStrokeColor(DEEP_2)
        c.circle(tx + 16, ty + 5, 7, stroke=1, fill=1)
        c.setFillColor(TEXT)
        c.setFont("Helvetica-Bold", 7.5)
        c.drawRightString(tx + 8, ty + 2, label)

    for i, label in enumerate(["NO / ON", "COM", "NC"]):
        tx = bx + bw + 45
        ty = by + 13 + i * 20
        c.line(bx + bw, ty + 5, tx - 24, ty + 5)
        c.setFillColor(WHITE)
        c.setStrokeColor(DEEP_2)
        c.circle(tx - 16, ty + 5, 7, stroke=1, fill=1)
        c.setFillColor(TEXT)
        c.setFont("Helvetica-Bold", 7.5)
        c.drawString(tx - 4, ty + 2, label)

    c.setStrokeColor(TEAL_DARK)
    c.setLineWidth(2)
    c.line(bx + 185, by + 23, bx + 228, by + 47)
    c.circle(bx + 180, by + 23, 2.5, stroke=1, fill=0)
    c.circle(bx + 235, by + 50, 2.5, stroke=1, fill=0)
    c.setFont("Helvetica", 7)
    c.setFillColor(MUTED)
    c.drawCentredString(bx + bw / 2, by + 12, "Relay contact drawn in simplified de-energized state")


def page_interface(c):
    header(c, "Electrical Interface", 4)
    section_title(c, "Interface", "Terminals and contact behavior")
    draw_terminal_map(c)
    rows = [
        ("IN+ / IN-", "Low-voltage DC input. Use a regulated 5-12 VDC supply and observe polarity."),
        ("COM", "Common relay contact. Connects to NO/ON or NC depending on relay state."),
        ("NO / ON", "Normally-open contact. Open when relay is inactive; closes to COM when relay activates."),
        ("NC", "Normally-closed contact. Connected to COM when relay is inactive; opens when relay activates."),
        ("Dry contact", "The output terminals do not provide load voltage. The external circuit supplies AC or DC load power."),
    ]
    table_draw(c, rows, MARGIN_X, 400, [108, 392], font_size=7.8)
    note_box(
        c,
        MARGIN_X,
        120,
        500,
        82,
        "Electrical safety note",
        "Keep the low-voltage input side isolated from the switched load circuit. Hazardous-voltage loads require a certified enclosure, strain relief, fuse or breaker protection, and installation by qualified personnel under local electrical codes.",
    )


def draw_ac_wiring(c, x, y, w, h):
    rounded_rect(c, x, y, w, h, WHITE, stroke=LINE, r=7)
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(DEEP_2)
    c.drawString(x + 14, y + h - 20, "Example A: AC load switched by relay contact")
    c.setFont("Helvetica", 7.2)
    c.setFillColor(MUTED)
    c.drawString(x + 14, y + h - 34, "Line is switched through COM and NO/ON. Neutral remains direct to load.")
    bx, by = x + 24, y + 48
    c.setStrokeColor(DEEP_2)
    c.setLineWidth(1.1)
    c.rect(bx, by, 120, 48, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 7)
    c.drawCentredString(bx + 60, by + 27, "MODULE")
    c.drawString(bx + 8, by + 10, "IN+ IN-")
    c.drawRightString(bx + 113, by + 10, "NO COM NC")
    c.setFont("Helvetica", 7)
    c.drawString(bx - 4, by - 18, "12 VDC supply")
    c.line(bx + 120, by + 20, bx + 178, by + 20)
    c.drawString(bx + 145, by + 26, "NO")
    c.line(bx + 178, by + 20, bx + 220, by + 20)
    c.line(bx + 220, by + 20, bx + 220, by - 2)
    c.circle(bx + 242, by - 8, 16, stroke=1, fill=0)
    c.line(bx + 231, by - 19, bx + 253, by + 3)
    c.line(bx + 253, by - 19, bx + 231, by + 3)
    c.drawString(bx + 228, by - 34, "Lamp / load")
    c.line(bx + 178, by + 20, bx + 178, by + 58)
    c.drawString(bx + 162, by + 64, "AC L")
    c.line(bx + 242, by + 8, bx + 242, by + 58)
    c.drawString(bx + 227, by + 64, "AC N")


def draw_dc_wiring(c, x, y, w, h):
    rounded_rect(c, x, y, w, h, WHITE, stroke=LINE, r=7)
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(DEEP_2)
    c.drawString(x + 14, y + h - 20, "Example B: DC lock or low-voltage load")
    c.setFont("Helvetica", 7.2)
    c.setFillColor(MUTED)
    c.drawString(x + 14, y + h - 34, "External DC supply is routed through COM and NO/ON to the controlled load.")
    bx, by = x + 24, y + 48
    c.setStrokeColor(DEEP_2)
    c.setLineWidth(1.1)
    c.rect(bx, by, 120, 48, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 7)
    c.drawCentredString(bx + 60, by + 27, "MODULE")
    c.drawString(bx + 8, by + 10, "IN+ IN-")
    c.drawRightString(bx + 113, by + 10, "NO COM NC")
    c.setFont("Helvetica", 7)
    c.drawString(bx - 4, by - 18, "5-12 VDC module supply")
    c.line(bx + 120, by + 20, bx + 196, by + 20)
    c.rect(bx + 196, by + 4, 42, 32, stroke=1, fill=0)
    c.drawString(bx + 202, by + 17, "Lock")
    c.line(bx + 238, by + 20, bx + 280, by + 20)
    c.drawString(bx + 258, by + 27, "DC-")
    c.line(bx + 166, by + 20, bx + 166, by + 58)
    c.drawString(bx + 145, by + 64, "DC+")


def page_wiring(c):
    header(c, "Wiring Examples", 5)
    section_title(c, "Integration", "Typical relay wiring examples")
    draw_ac_wiring(c, MARGIN_X, 435, 500, 180)
    draw_dc_wiring(c, MARGIN_X, 225, 500, 180)
    note_box(
        c,
        MARGIN_X,
        95,
        500,
        82,
        "Load and code note",
        "Relay contact ratings are component reference ratings, not a full end-product safety approval. Derate inductive loads, add flyback / snubber protection where needed, and validate insulation, creepage, clearance, wiring, and enclosure design for the target market.",
    )


def step_block(c, num, title, body, x, y, w):
    rounded_rect(c, x, y, w, 62, WHITE, stroke=LINE, r=7)
    c.setFillColor(DEEP)
    c.circle(x + 22, y + 31, 13, stroke=0, fill=1)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(x + 22, y + 27.5, str(num))
    c.setFillColor(DEEP_2)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x + 45, y + 41, title)
    draw_wrapped(c, body, x + 45, y + 27, w - 58, size=7.4, color=MUTED, leading=9.8)


def page_setup(c):
    header(c, "Bluetooth Setup", 6)
    section_title(c, "Setup", "Pairing and configuration workflow")
    steps = [
        ("Wire the module", "Connect the module power input and the controlled circuit before pairing."),
        ("Enable phone Bluetooth", "Keep Bluetooth enabled. The phone acts as the proximity key after pairing."),
        ("Open mini-program", "Scan the supplier-provided WeChat mini-program QR code; iOS and Android are supported through WeChat."),
        ("Pair NBH-* device", "Select the Bluetooth device whose name begins with NBH-. Default password: 123456."),
        ("Set behavior", "Configure name, password, sensing distance, unlock threshold, lock threshold, and pulse / latching mode."),
        ("Test and save", "Walk toward and away from the module, verify relay behavior, then save settings for the installed environment."),
    ]
    y = 580
    for i, (title, body) in enumerate(steps, 1):
        col = 0 if i % 2 == 1 else 1
        row = (i - 1) // 2
        step_block(c, i, title, body, MARGIN_X + col * 254, y - row * 83, 238)

    note_box(
        c,
        MARGIN_X,
        210,
        500,
        82,
        "Bluetooth proximity behavior",
        "Sensing distance is inferred from Bluetooth signal strength and may vary with phone model, antenna orientation, body blocking, enclosure material, battery level, and nearby RF noise. Always tune thresholds after final installation.",
        fill=HexColor("#EEF7FF"),
        stroke=HexColor("#9CC8E7"),
    )
    rounded_rect(c, MARGIN_X, 102, 500, 70, MINT, stroke=LINE, r=7)
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(DEEP_2)
    c.drawString(MARGIN_X + 16, 148, "Configuration scope")
    bullet_list(
        c,
        [
            "Device name and pairing password can be changed.",
            "Unlock and lock signal thresholds support proximity-distance tuning.",
            "Latching mode and momentary mode support different control use cases.",
        ],
        MARGIN_X + 16,
        132,
        462,
        size=7.7,
        gap=2.5,
    )


def page_logic(c):
    header(c, "Operating Logic", 7)
    section_title(c, "Control Logic", "Latching and momentary relay behavior")
    rounded_rect(c, MARGIN_X, 445, 500, 170, WHITE, stroke=LINE, r=7)
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(DEEP_2)
    c.drawString(MARGIN_X + 14, 588, "Latching proximity mode")
    c.setFont("Helvetica", 7.4)
    c.setFillColor(MUTED)
    c.drawString(MARGIN_X + 14, 574, "Relay closes when signal exceeds unlock threshold; relay opens when signal falls below lock threshold.")
    ox, oy = MARGIN_X + 45, 500
    c.setStrokeColor(LINE)
    c.line(ox, oy, ox + 400, oy)
    c.line(ox, oy + 45, ox + 400, oy + 45)
    c.setStrokeColor(TEAL_DARK)
    c.setLineWidth(2)
    points = [(ox, oy + 8), (ox + 70, oy + 18), (ox + 135, oy + 52), (ox + 230, oy + 55), (ox + 310, oy + 24), (ox + 400, oy + 10)]
    for a, b in zip(points, points[1:]):
        c.line(a[0], a[1], b[0], b[1])
    c.setStrokeColor(WARNING)
    c.setLineWidth(1)
    c.line(ox, oy + 38, ox + 400, oy + 38)
    c.line(ox, oy + 20, ox + 400, oy + 20)
    c.setFillColor(WARNING)
    c.setFont("Helvetica", 6.8)
    c.drawRightString(ox - 7, oy + 35, "Unlock")
    c.drawRightString(ox - 7, oy + 17, "Lock")
    c.setFillColor(DEEP_2)
    c.drawCentredString(ox + 205, oy - 16, "Phone proximity signal over time")

    rounded_rect(c, MARGIN_X, 245, 500, 160, WHITE, stroke=LINE, r=7)
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(DEEP_2)
    c.drawString(MARGIN_X + 14, 378, "Momentary / pulse mode")
    c.setFont("Helvetica", 7.4)
    c.setFillColor(MUTED)
    c.drawString(MARGIN_X + 14, 364, "Relay closes for the configured pulse duration when the trigger condition is met.")
    ox, oy = MARGIN_X + 80, 305
    c.setStrokeColor(DEEP_2)
    c.setLineWidth(1.2)
    c.line(ox, oy, ox + 350, oy)
    c.line(ox, oy, ox, oy + 45)
    c.setStrokeColor(TEAL_DARK)
    c.setLineWidth(2)
    c.line(ox + 20, oy + 5, ox + 95, oy + 5)
    c.line(ox + 95, oy + 5, ox + 95, oy + 35)
    c.line(ox + 95, oy + 35, ox + 180, oy + 35)
    c.line(ox + 180, oy + 35, ox + 180, oy + 5)
    c.line(ox + 180, oy + 5, ox + 310, oy + 5)
    c.setFont("Helvetica", 7)
    c.setFillColor(MUTED)
    c.drawString(ox + 105, oy + 43, "Configured pulse time")

    rounded_rect(c, MARGIN_X, 82, 500, 112, MINT_2, stroke=LINE, r=7)
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(DEEP_2)
    c.drawString(MARGIN_X + 16, 170, "Typical application fit")
    bullet_list(
        c,
        [
            "E-bike, motorcycle, or small-vehicle keyless enable systems where the final integrator validates safety.",
            "Garage, cabinet, equipment-enable, or access-control prototypes using a relay dry contact.",
            "OEM learning platforms and secondary development projects requiring Bluetooth-based proximity behavior.",
        ],
        MARGIN_X + 16,
        153,
        462,
        size=7.6,
        gap=3,
    )


def page_compliance(c, imgs):
    header(c, "Compliance Notes", 8)
    section_title(c, "Regulatory", "Compliance and ordering notes")
    text_x = MARGIN_X
    bullet_list(
        c,
        [
            "<b>No certification claim is made in this preliminary datasheet</b> unless supported by current certificates for the exact SKU and production batch.",
            "Bluetooth radio products and final host devices may require market-specific approvals such as FCC Part 15, CE RED, UKCA, ISED, MIC, SRRC, KC, or other national RF rules.",
            "Switching mains or vehicle circuits can trigger additional safety, EMC, enclosure, insulation, fusing, cable, and installation-code requirements.",
            "RoHS, REACH, battery, packaging, and material declarations should be confirmed per order, destination market, and final product configuration.",
            "The final integrator is responsible for validating security, electrical safety, EMC, RF exposure, labeling, and user documentation for the finished product.",
        ],
        text_x,
        640,
        310,
        size=7.9,
        gap=6,
    )

    rounded_rect(c, 398, 455, 158, 185, WHITE, stroke=LINE, r=7)
    c.setFont("Helvetica-Bold", 8.5)
    c.setFillColor(DEEP_2)
    c.drawString(410, 623, "Packaging reference")
    image_within(c, imgs["package"], 410, 475, 134, 136)
    c.setFont("Helvetica", 6.8)
    c.setFillColor(MUTED)
    c.drawString(410, 465, "Reference packaging; final packaging may vary")

    rows = [
        ("Ordering item", "Bluetooth Proximity Relay Module"),
        ("Included item", "Relay module board; mini-program QR / setup document supplied separately by seller or service team"),
        ("Support", "OEM customization and secondary development support available by project request"),
        ("Website", "www.rogersense.com"),
        ("Document revision", "1.0, June 6, 2026"),
    ]
    table_draw(c, rows, MARGIN_X, 365, [130, 370], font_size=7.6)
    note_box(
        c,
        MARGIN_X,
        105,
        500,
        92,
        "Customer download edition",
        "This document is prepared for customer evaluation and online product presentation. Before high-volume sale or regulated-market shipment, replace preliminary statements with confirmed certificates, test reports, firmware version, labeling artwork, and final user instructions.",
        fill=WHITE,
        stroke=LINE,
    )


def build_pdf(assets_dir: Path, output: Path):
    output.parent.mkdir(parents=True, exist_ok=True)
    work_dir = Path("/private/tmp/rogersense-bluetooth-relay-assets")
    imgs = prepare_assets(assets_dir, work_dir)
    c = canvas.Canvas(str(output), pagesize=letter)
    c.setTitle("Rogersense Bluetooth Proximity Relay Module Product Specification")
    c.setAuthor("Rogersense")
    draw_cover(c, imgs)
    c.showPage()
    page_overview(c, imgs)
    c.showPage()
    page_specs(c)
    c.showPage()
    page_interface(c)
    c.showPage()
    page_wiring(c)
    c.showPage()
    page_setup(c)
    c.showPage()
    page_logic(c)
    c.showPage()
    page_compliance(c, imgs)
    c.save()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    build_pdf(args.assets_dir, args.output)


if __name__ == "__main__":
    main()
