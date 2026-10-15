#!/usr/bin/env python3
"""research-scope-mcp marketplace icon — 400×400 PNG (drawn once, deterministic).
Needs reportlab (draw) + PyMuPDF (rasterize) — they may live in different
interpreters; the --raster flag splits the job."""
import sys
if "--raster" in sys.argv:
    # raster stage lives in a reportlab-free interpreter
    import fitz
    doc = fitz.open("/tmp/rsmcp-logo.pdf")
    pix = doc[0].get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
    pix.save("/Users/agent/Projects/research-scope-mcp/docs/logo/logo-400.png")
    print("saved", pix.width, "x", pix.height, "|", pix.n, "channels")
    raise SystemExit(0)
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

PNG = 400
PDF_S = 400  # 1pt = 1px scale for the render
INK = HexColor("#1a1a1a")
CREAM = HexColor("#f3efe4")
FAINT = HexColor("#8a8a7a")
GREEN = HexColor("#3d5a3d")
RED = HexColor("#8c3b2e")

c = canvas.Canvas("/tmp/rsmcp-logo.pdf", pagesize=(PDF_S, PDF_S))
# cream field + ink border
c.setFillColor(CREAM)
c.rect(0, 0, PDF_S, PDF_S, fill=1, stroke=0)
c.setStrokeColor(INK)
c.setLineWidth(10)
c.rect(18, 18, PDF_S - 36, PDF_S - 36, fill=0, stroke=1)
# document grid (the report shell)
cx, cy, cw = 70, 96, 150
rows = 9
ch = 26 * rows
c.setLineWidth(4)
for r in range(rows + 1):
    y = cy + r * 26
    c.line(cx, y, cx + cw, y)
for k in range(4):
    x = cx + k * 50
    c.line(x, cy, x, cy + ch)
# the "S2" checkpoint stamp overlapping one cell
c.setFillColor(RED)
c.rect(cx + 100, cy + 26 * 5 - 4, 44, 26, fill=1, stroke=0)
c.setFillColor(CREAM)
c.setFont("Helvetica-Bold", 13)
c.drawCentredString(cx + 122, cy + 26 * 5 + 2, "S2")
# magnifier over the document — the scoring eye
c.setStrokeColor(INK)
c.setLineWidth(9)
c.circle(268, 210, 62, stroke=1, fill=0)
c.setLineWidth(16)
c.line(310, 158, 356, 112)
c.setStrokeColor(GREEN)
c.setLineWidth(5)
c.line(214, 210, 322, 210)  # score bar through the lens
c.setStrokeColor(RED)
c.line(214, 184, 268, 184)  # a failing dimension
# registry tick under the stamp
c.setStrokeColor(GREEN)
c.setLineWidth(7)
c.line(96, 62, 116, 44)
c.line(116, 44, 150, 78)
c.save()
print("PDF drawn; run the same script with --raster (system python3, PyMuPDF) for logo-400.png")
