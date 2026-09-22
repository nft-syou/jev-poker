"""Composes public/og.png (1200x630): a frame of the table with the name and tagline over it.

One-off tooling (needs Pillow). scripts/og-source.jpg is a frame from the showcase
recording; replace it and re-run to refresh the card.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H = 1200, 630
GOLD, WHITE, FELT = "#ffd54f", "#f4efe6", "#0b1a12"


def font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for name in candidates:
        path = Path("C:/Windows/Fonts") / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    raise SystemExit(f"none of {candidates} found")


frame = Image.open(ROOT / "scripts/og-source.jpg").convert("RGB")
# 16:9 -> 1200x630: scale to width, keep the top (the table), drop the ticker strip.
frame = frame.resize((W, round(frame.height * W / frame.width)), Image.LANCZOS).crop((0, 0, W, H))

# Darken the lower part so white text reads over the felt and the panel.
shade = Image.new("L", (W, H), 0)
for y in range(H):
    t = max(0.0, (y - H * 0.45) / (H * 0.55))
    ImageDraw.Draw(shade).line([(0, y), (W, y)], fill=int(235 * t**1.2))
frame = Image.composite(Image.new("RGB", (W, H), FELT), frame, shade)

chip = Image.open(ROOT / "public/icon-512.png").convert("RGBA").resize((132, 132), Image.LANCZOS)
d = ImageDraw.Draw(frame)
title_font = font(["segoeuib.ttf", "arialbd.ttf"], 92)
tag_font = font(["YuGothB.ttc", "meiryob.ttc", "msgothic.ttc"], 38)
sub_font = font(["segoeuisb.ttf", "seguisb.ttf", "arial.ttf"], 28)

x, y = 64, 372
frame.paste(chip, (x, y - 8), chip)
d.text((x + 156, y - 26), "jev-poker", font=title_font, fill=GOLD)
d.text((x + 4, y + 148), "CPU が TypeSafe Jev で考えるノーリミットホールデム", font=tag_font, fill=WHITE)
d.text((x + 4, y + 204), "Every CPU decision comes with Jev's probabilities. Bring your own key.", font=sub_font, fill="#cfd8d1")

out = ROOT / "public/og.png"
frame.save(out, optimize=True)
print("wrote", out, out.stat().st_size, "bytes")
