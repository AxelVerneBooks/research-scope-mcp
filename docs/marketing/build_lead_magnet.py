#!/usr/bin/env python3
"""Lead-magnet PDF — 'Research-to-Report: the one-page sources scoring checklist'.

One page, US Letter, tiny file (the $0+ Gumroad free-listing file-size limit applies,
so this is drawn from cached fonts only — no embedded images). Rubric matches
src/scoring/score.ts weights exactly, so the checklist IS the server's scoring rule,
printed.  Run with system python3+reportlab or the farm-ledger venv.
"""
import os
import textwrap

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

W, H = letter
M = 40
INK = HexColor("#1a1a1a")
CREAM = HexColor("#f3efe4")
FAINT = HexColor("#8a8a7a")
RED = HexColor("#8c3b2e")
GREEN = HexColor("#3d5a3d")
SANS, SANS_B = "Helvetica", "Helvetica-Bold"
SERIF, SERIF_B, SERIF_I = "Times-Roman", "Times-Bold", "Times-Italic"


def para(c, x, y, text, width=118, size=9, leading=12.5, font=SERIF, color=INK):
    for chunk in text.split("\n"):
        lines = textwrap.wrap(chunk, width) or [""]
        c.setFont(font, size)
        c.setFillColor(color)
        for ln in lines:
            c.drawString(x, y, ln)
            y -= leading
    return y


c = canvas.Canvas("/Users/agent/Projects/research-scope-mcp/docs/marketing/lead-magnet-sources-scoring-checklist.pdf", pagesize=letter)
c.setTitle("Research-to-Report: the one-page sources scoring checklist")
c.setAuthor("Axel Verne")

# header band
c.setFillColor(CREAM)
c.rect(0, H - 70, W, 70, fill=1, stroke=0)
c.setStrokeColor(INK); c.setLineWidth(2); c.line(0, H - 70, W, H - 70)
c.setFont(SANS, 7); c.setFillColor(FAINT)
c.drawString(M, H - 20, "RESEARCH-TO-REPORT  ·  THE MCP KIT FOR SCOPED, SCORED, CITED RESEARCH")
c.setFont(SERIF_B, 17); c.setFillColor(INK)
c.drawString(M, H - 44, "The one-page sources scoring checklist")
c.setFont(SERIF_I, 9); c.setFillColor(FAINT)
c.drawString(M, H - 58, "the exact rubric the research-scope-mcp server runs on every source — keep it by your review table")

y = H - 92

# The rubric — five dimensions, weights matching score.ts
y = para(c, M, y,
         "Score every source 0–100 across five dimensions before it earns a citation number. "
         "The server returns this evidence with every score — a score is auditable, not a vibe.",
         width=112, size=9)
y -= 10

rows = [
    ("1  Availability & substance", "20", "Reachable (HTTP 200) and extractable text length: 3,000+ chars vs thin/stub pages. Dead pages score 0 — dead-link, no exceptions."),
    ("2  Primary-source status", "32", "Who is TALKING? A primary host (gov/edu/filings/standards) — or the claim-maker speaking for itself (press release, announcement, changelog). Everyone else is a secondary: strength = how many primaries it cites."),
    ("3  Freshness", "24", "Publication date found + dated: ≤30d full marks → decaying → 2 pts past 5 years. UNDATED = 0 here and a hard design rule: never let an undated page be load-bearing for a fast-moving claim."),
    ("4  Access", "12", "Open and loadable in full. Paywall / registration walls lose most of this — cite what your reader can actually open."),
    ("5  Independence", "12", "No sponsored/affiliate/partnership markers, no vendor page scoring its own product. The claim page itself is evidence OF the claim, never evidence FOR it."),
]
row_h = 46
col0, col1, col2 = 210, 34, W - 2 * M - 210 - 34
gx = W - M
c.setStrokeColor(INK); c.setLineWidth(0.8)
for i, (name, wpts, desc) in enumerate(rows):
    ry = y - row_h
    c.setFillColor(CREAM if i % 2 == 0 else HexColor("#ffffff"))
    c.rect(M, ry, W - 2 * M, row_h, fill=1, stroke=0)
    c.setStrokeColor(INK); c.setLineWidth(0.8); c.rect(M, ry, W - 2 * M, row_h, fill=0, stroke=1)
    c.setFont(SANS_B, 9); c.setFillColor(INK)
    c.drawString(M + 8, y - 16, name)
    c.setFont(SERIF_B, 12); c.setFillColor(RED)
    c.drawString(M + col0, y - 17, wpts)
    c.setFont(SERIF, 8.2); c.setFillColor(FAINT)
    dlines = textwrap.wrap(desc, 44)
    c.setFillColor(INK)
    for j, dl in enumerate(dlines[:3]):
        c.setFillColor(INK if j == 0 else FAINT)
        c.setFont(SERIF if j == 0 else SERIF_I, 8.4 if j == 0 else 7.6)
        c.drawString(M + col0 + 34, y - 12 - j * 10.5, dl)
    y = ry
y -= 22

# grade bands
c.setFont(SANS_B, 9); c.setFillColor(GREEN)
c.drawString(M, y, "GRADE BANDS:   A ≥ 80 · B ≥ 65 · C ≥ 45 · D < 45")
c.setFont(SERIF_I, 8.5); c.setFillColor(FAINT)
c.drawString(M + 240, y, "Kill rules: < 45 = cannot cite · < 2 sources ≥ 45 = report 'insufficient sources' · number + paywalled primary = claim unverifiable")
y -= 26

# report shell template box
bh = 148
c.setStrokeColor(INK); c.setLineWidth(1.2)
c.rect(M, y - bh, W - 2 * M, bh, fill=0, stroke=1)
c.setFont(SANS_B, 8.5); c.setFillColor(RED)
c.drawString(M + 8, y - 16, "THE REPORT SHELL — write your report INSIDE this shape and citations become mechanical:")
c.setFont(SERIF, 8.6); c.setFillColor(INK)
ty = y - 32
for ln in [
    "# <Report title>  (+ date, + author)",
    "## Claims   (one editable truth per line/bullet, tagged [S1] [S2] like the example)",
    "  . The 2025 redesign moved EMT testing to CAT (70-120 items) [S2]",
    "## Citation registry   (one line per source, numbered [Sn])",
    "  [S1] <url> - score 88/100 (A, published 2025-04)     (from the server's fetch_and_score)",
    "  [S2] <url> - score 71/100 (B, no date)   (the 'no date' flag is IN the file, visible to the reader)",
    "## Scoring appendix   (per-source flags; where a reader audits you in 90 seconds)",
]:
    c.setFont(SERIF, 8.6)
    c.drawString(M + 10, ty, ln)
    ty -= 13.5
y -= bh + 8

# the workflow loop
c.setFont(SANS_B, 8.5); c.setFillColor(GREEN)
c.drawString(M, y, "THE 4-STEP LOOP (what the server automates):")
c.setFont(SERIF, 9); c.setFillColor(INK)
yy = y - 13
for ln in [
    "1  plan_research(scope) => source targets + kill criteria, before touching a browser",
    "2  fetch_and_score(url) => the rubric above, run mechanically, one line per source",
    "3  build_report(topic, sources) => this shell, generated with your scored sources married in",
    "4  check_report() => every claim must cite >=1 scored source; orphans come back as ERRORS",
]:
    c.drawString(M + 10, yy, ln); yy -= 13

# footer + pitch
c.setStrokeColor(INK); c.setLineWidth(0.8); c.line(M, 44, W - M, 44)
c.setFont(SANS, 6.8); c.setFillColor(FAINT)
c.drawString(M, 34, "Research-to-Report MCP Kit · rubric v1 matches research-scope-mcp 0.1.0 · free to print for your own research table")
c.drawRightString(W - M, 34, "kit: server + field guide + worked runs → axelverne.com")
c.save()
print("lead magnet written:",
      round(os.path.getsize("/Users/agent/Projects/research-scope-mcp/docs/marketing/lead-magnet-sources-scoring-checklist.pdf") / 1024.0, 1), "KB")
