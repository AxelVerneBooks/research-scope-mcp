#!/usr/bin/env python3
"""600x600 square thumbnail for the sources-scoring-checklist listing.

Reuse of the lead magnet PDF's design system (build_lead_magnet.py palette:
cream paper, ink, faint grey, red accent, green accent), drawn with Pillow so
it can also be shipped byte-exact. Output: demo-60s/thumb-checklist-600.png
"""
from PIL import Image, ImageDraw, ImageFont

W = H = 600
CREAM = "#f3efe4"
INK = "#1a1a1a"
FAINT = "#8a8a7a"
RED = "#8c3b2e"
GREEN = "#3d5a3d"
PAPER = "#faf7ec"

F = "/System/Library/Fonts/Supplemental/"
serif_b = lambda s: ImageFont.truetype(F + "Times New Roman Bold.ttf", s)
serif_i = lambda s: ImageFont.truetype(F + "Times New Roman Italic.ttf", s)
sans = lambda s: ImageFont.truetype(F + "Arial.ttf", s)
sans_b = lambda s: ImageFont.truetype(F + "Arial Bold.ttf", s)

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)

# main type block
d.text((52, 52), "RESEARCH-TO-REPORT", font=sans_b(21), fill=RED)
d.text((52, 84), "FREE ONE-PAGER", font=sans_b(17), fill=FAINT)
d.text((52, 150), "The one-page sources", font=serif_b(52), fill=INK)
d.text((52, 208), "scoring checklist", font=serif_b(52), fill=INK)
d.text((52, 286), "the exact rubric the research-scope-mcp server", font=serif_i(19), fill=FAINT)
d.text((52, 312), "runs on every source - keep it by your review table", font=serif_i(19), fill=FAINT)

# five weights, served as a scored list (matches score.ts)
weights = [("Availability", 20), ("Primary-source", 32), ("Freshness", 24),
           ("Access", 12), ("Independence", 12)]
y = 372
for name, pts in weights:
    d.ellipse((52, y + 4, 66, y + 18), outline=GREEN, width=3)
    d.line((56, y + 11, 60, y + 15), fill=GREEN, width=3)
    d.line((60, y + 15, 64, y + 6), fill=GREEN, width=3)
    d.text((78, y), name, font=sans_b(19), fill=INK)
    d.text((320, y), f"{pts} pts", font=sans(19), fill=FAINT)
    y += 34
d.text((78, y + 12), "score every source 0-100 across five dimensions", font=serif_i(18), fill=GREEN)

# bottom band
d.rectangle((0, H - 56, W, H), fill=CREAM)
d.line((0, H - 56, W, H - 56), fill=INK, width=3)
d.text((52, H - 42), "axelverne.com", font=sans_b(16), fill=INK)
tw = d.textlength("sources-scoring-checklist", font=sans(16))
d.text((W - 52 - tw, H - 42), "sources-scoring-checklist", font=sans(16), fill=FAINT)

img.save("/Users/agent/Projects/research-scope-mcp/docs/marketing/demo-60s/thumb-checklist-600.png", optimize=True)
