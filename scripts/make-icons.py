"""Renders the site icons from one design: a red chip with a gold J on green felt.

One-off tooling (needs Pillow); the outputs under public/ are committed. Re-run after
changing the design here or in public/favicon.svg, which is the same drawing by hand.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PUBLIC = Path(__file__).resolve().parent.parent / "public"
RED, WHITE, FELT, GOLD = "#b8382c", "#f4efe6", "#123d28", "#ffd54f"
FONT = "C:/Windows/Fonts/segoeuib.ttf"


def chip(size: int, background: str | None = None) -> Image.Image:
    # Draw at 4x and downsample: PIL's primitives have no anti-aliasing of their own.
    s = size * 4
    img = Image.new("RGBA", (s, s), background or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c, r = s / 2, s * 0.47
    d.ellipse((c - r, c - r, c + r, c + r), fill=RED)
    # Eight white edge marks, the way a real chip is printed.
    ring = r * 0.86
    for i in range(8):
        a0 = i * 45 - 9
        d.arc((c - ring, c - ring, c + ring, c + ring), a0, a0 + 18, fill=WHITE, width=int(s * 0.075))
    inner = r * 0.66
    d.ellipse((c - inner, c - inner, c + inner, c + inner), fill=FELT)
    font = ImageFont.truetype(FONT, int(s * 0.5))
    box = d.textbbox((0, 0), "J", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text((c - w / 2 - box[0], c - h / 2 - box[1] - s * 0.01), "J", font=font, fill=GOLD)
    return img.resize((size, size), Image.LANCZOS)


PUBLIC.mkdir(exist_ok=True)
for size, name in [(512, "icon-512.png"), (192, "icon-192.png")]:
    chip(size).save(PUBLIC / name)
# iOS composites its own rounded corners and dislikes transparency: give it the felt.
chip(180, FELT).save(PUBLIC / "apple-touch-icon.png")
chip(64).save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print("icons written to", PUBLIC)
