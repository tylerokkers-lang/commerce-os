#!/usr/bin/env python3
"""
Commerce OS Owner's Manual — PDF generator.

This script is the SOURCE for Commerce-OS-Owners-Manual.pdf. Every factual
claim inside the CONTENT below was verified against the actual repository
(code, HANDOVER.md, migrations, tests) at commit 522c351 plus the "Live
Channel Compliance & Readiness" milestone committed immediately after this
document. Regenerate by re-running this script after updating the CONTENT
data below to match the repository's real, current state — never edit the
PDF directly, and never add a claim here that is not backed by something
verifiable in the repository.

Run: python3 generate_owners_manual.py
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    PageBreak, NextPageTemplate, FrameBreak, KeepTogether, ListFlowable, ListItem,
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfgen import canvas as canvas_mod
import datetime

# ---------------------------------------------------------------------------
# Constants / facts (verified against the repo — see module docstring)
# ---------------------------------------------------------------------------

COMMIT_HASH = "522c351"
GENERATED_ON = datetime.date.today().strftime("%d %B %Y")
PAGE_SIZE = A4
MARGIN = 20 * mm
CONTENT_WIDTH = PAGE_SIZE[0] - 2 * MARGIN - 14  # safety buffer under Frame's own default cell padding

NAVY = colors.HexColor("#1a2744")
ACCENT = colors.HexColor("#2f6fed")
POSITIVE = colors.HexColor("#1a7f4e")
CAUTION = colors.HexColor("#a35a00")
NEGATIVE = colors.HexColor("#b3261e")
NEUTRAL = colors.HexColor("#5b6472")
LIGHT_BG = colors.HexColor("#f2f4f8")
BORDER = colors.HexColor("#d6dae2")

# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------

styles = getSampleStyleSheet()

styles.add(ParagraphStyle(name="CoverTitle", fontName="Helvetica-Bold", fontSize=34, leading=40, textColor=NAVY, alignment=TA_CENTER, spaceAfter=6))
styles.add(ParagraphStyle(name="CoverSubtitle", fontName="Helvetica-Bold", fontSize=16, leading=22, textColor=ACCENT, alignment=TA_CENTER, spaceAfter=28))
styles.add(ParagraphStyle(name="CoverTag", fontName="Helvetica", fontSize=12, leading=17, textColor=colors.black, alignment=TA_CENTER, spaceAfter=10))
styles.add(ParagraphStyle(name="CoverMeta", fontName="Helvetica", fontSize=10.5, leading=15, textColor=NEUTRAL, alignment=TA_CENTER))

styles.add(ParagraphStyle(name="PartHeading", fontName="Helvetica-Bold", fontSize=20, leading=25, textColor=NAVY, spaceBefore=6, spaceAfter=14, keepWithNext=True))
styles.add(ParagraphStyle(name="SubHeading", fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=ACCENT, spaceBefore=16, spaceAfter=8, keepWithNext=True))
styles.add(ParagraphStyle(name="SubSubHeading", fontName="Helvetica-Bold", fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=10, spaceAfter=5, keepWithNext=True))

styles.add(ParagraphStyle(name="Body", fontName="Helvetica", fontSize=10, leading=14.5, textColor=colors.black, spaceAfter=7, alignment=TA_LEFT))
styles.add(ParagraphStyle(name="BodyBold", parent=styles["Body"], fontName="Helvetica-Bold"))
styles.add(ParagraphStyle(name="Small", parent=styles["Body"], fontSize=8.7, leading=12, textColor=NEUTRAL))
styles.add(ParagraphStyle(name="MyBullet", parent=styles["Body"], leftIndent=0, spaceAfter=4))
styles.add(ParagraphStyle(name="TOCPart", fontName="Helvetica-Bold", fontSize=12, leading=18, textColor=NAVY, spaceAfter=2))
styles.add(ParagraphStyle(name="TOCSub", fontName="Helvetica", fontSize=10, leading=15, textColor=colors.black, leftIndent=14, spaceAfter=1))
styles.add(ParagraphStyle(name="GlossaryTerm", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=NAVY, spaceBefore=8, spaceAfter=2))
styles.add(ParagraphStyle(name="GlossaryDef", parent=styles["Body"], leftIndent=0))
styles.add(ParagraphStyle(name="TableCell", fontName="Helvetica", fontSize=8.6, leading=11.5, textColor=colors.black))
styles.add(ParagraphStyle(name="TableCellBold", parent=styles["TableCell"], fontName="Helvetica-Bold"))
styles.add(ParagraphStyle(name="TableHeadCell", fontName="Helvetica-Bold", fontSize=8.8, leading=11.5, textColor=colors.white))
styles.add(ParagraphStyle(name="Disclaimer", fontName="Helvetica-Oblique", fontSize=9.3, leading=13, textColor=NEUTRAL, spaceAfter=8))
styles.add(ParagraphStyle(name="WarnHead", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=NEGATIVE))
styles.add(ParagraphStyle(name="IndexEntry", fontName="Helvetica", fontSize=9.3, leading=13.5))

# ---------------------------------------------------------------------------
# Index tracking (mirrors the reportlab TOC notification mechanism)
# ---------------------------------------------------------------------------

INDEX_TERMS = {}  # (id(IndexMark instance), term) -> page; overwritten each pass so only the final, stable pass's value survives


class IndexMark(Spacer):
    """A zero-size flowable whose only purpose is to record the page it lands on."""

    def __init__(self, term):
        super().__init__(0, 0)
        self.term = term


# ---------------------------------------------------------------------------
# Document template with a working, real, page-numbered TOC
# ---------------------------------------------------------------------------


class ManualDocTemplate(BaseDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            style = flowable.style.name
            text = flowable.getPlainText()
            if style == "PartHeading":
                self.notify("TOCEntry", (0, text, self.page))
                key = text.split(".", 1)[-1].strip() if "." in text[:4] else text
                self.canv.bookmarkPage(f"bm_{abs(hash(text))}")
                flowable._bookmarkName = f"bm_{abs(hash(text))}"
            elif style == "SubHeading":
                self.notify("TOCEntry", (1, text, self.page))
        if isinstance(flowable, IndexMark):
            # Overwrite, not accumulate: multiBuild re-walks the whole story
            # on every internal pass while stabilising the TOC, so the same
            # IndexMark fires afterFlowable once per pass. Keying on the
            # mark's own identity and overwriting means only the last
            # (stable) pass's page number for this exact mark survives.
            INDEX_TERMS[(id(flowable), flowable.term)] = self.page


def header_footer(canv: canvas_mod.Canvas, doc):
    canv.saveState()
    canv.setStrokeColor(BORDER)
    canv.setLineWidth(0.5)
    canv.line(MARGIN, 15 * mm, PAGE_SIZE[0] - MARGIN, 15 * mm)
    canv.setFont("Helvetica", 8.3)
    canv.setFillColor(NEUTRAL)
    canv.drawString(MARGIN, 10 * mm, "Commerce OS — Owner's Manual")
    canv.drawRightString(PAGE_SIZE[0] - MARGIN, 10 * mm, f"Page {doc.page}")
    canv.restoreState()


def cover_page(canv: canvas_mod.Canvas, doc):
    canv.saveState()
    canv.setFillColor(NAVY)
    canv.rect(0, PAGE_SIZE[1] - 55 * mm, PAGE_SIZE[0], 55 * mm, fill=1, stroke=0)
    canv.restoreState()


def build_frame_template(name, onPage):
    frame = Frame(MARGIN, MARGIN, PAGE_SIZE[0] - 2 * MARGIN, PAGE_SIZE[1] - 2 * MARGIN, id=f"{name}_frame")
    return PageTemplate(id=name, frames=[frame], onPage=onPage)


OUTPUT_PATH = "Commerce-OS-Owners-Manual.pdf"


def make_doc(path):
    """Fresh BaseDocTemplate instance — used twice, see the two-stage build at the bottom of this script."""
    d = ManualDocTemplate(
        path,
        pagesize=PAGE_SIZE,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN,
        title="Commerce OS Owner's Manual",
        author="Commerce OS",
        subject="System architecture and operator guide, generated from the live repository",
    )
    d.addPageTemplates([
        build_frame_template("cover", cover_page),
        build_frame_template("normal", header_footer),
    ])
    return d


toc = TableOfContents()
toc.levelStyles = [styles["TOCPart"], styles["TOCSub"]]

story = []

# ---------------------------------------------------------------------------
# Helper builders
# ---------------------------------------------------------------------------


def part(text):
    story.append(Paragraph(text, styles["PartHeading"]))


def sub(text, index_term=None):
    if index_term:
        story.append(IndexMark(index_term))
    story.append(Paragraph(text, styles["SubHeading"]))


def subsub(text):
    story.append(Paragraph(text, styles["SubSubHeading"]))


def body(text):
    story.append(Paragraph(text, styles["Body"]))


def small(text):
    story.append(Paragraph(text, styles["Small"]))


def bullets(items):
    story.append(ListFlowable(
        [ListItem(Paragraph(t, styles["MyBullet"]), bulletColor=ACCENT) for t in items],
        bulletType="bullet", start="•", leftIndent=14, bulletFontSize=8,
    ))
    story.append(Spacer(1, 4))


def numbered(items):
    story.append(ListFlowable(
        [ListItem(Paragraph(t, styles["MyBullet"])) for t in items],
        bulletType="1", leftIndent=16, start=1,
    ))
    story.append(Spacer(1, 4))


def spacer(h=6):
    story.append(Spacer(1, h))


def status_badge(text, kind="neutral"):
    color = {"positive": POSITIVE, "caution": CAUTION, "negative": NEGATIVE, "neutral": NEUTRAL, "accent": ACCENT}[kind]
    return f'<font color="{color.hexval()}"><b>{text}</b></font>'


def data_table(header, rows, col_widths, header_bg=NAVY):
    def cell(v, bold=False):
        if isinstance(v, str):
            return Paragraph(v, styles["TableCellBold"] if bold else styles["TableCell"])
        return v
    data = [[Paragraph(h, styles["TableHeadCell"]) for h in header]]
    for r in rows:
        data.append([cell(v) for v in r])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), header_bg),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t)
    spacer(10)


def _boxed_paragraph(html, border_color, back_color, border_width=1, alignment=TA_LEFT, font_size=10, leading=14.5):
    # A single Paragraph (not a Table) so a long box can split across a page
    # boundary instead of raising a LayoutError when it doesn't fit whole.
    style = ParagraphStyle(
        name=f"box_{abs(hash((html[:20], border_color, back_color)))}",
        parent=styles["Body"],
        borderWidth=border_width, borderColor=border_color, borderPadding=10, borderRadius=3,
        backColor=back_color, alignment=alignment, fontSize=font_size, leading=leading,
        spaceBefore=2, spaceAfter=10,
    )
    story.append(Paragraph(html, style))


def warning_box(title, lines):
    html = f'<font color="{NEGATIVE.hexval()}"><b>{title}</b></font><br/><br/>' + "<br/>".join(f"• {l}" for l in lines)
    _boxed_paragraph(html, NEGATIVE, colors.HexColor("#fdf1f0"))


def note_box(lines, heading="Note"):
    html = f"<b>{heading}</b><br/><br/>" + "<br/>".join(lines)
    _boxed_paragraph(html, ACCENT, colors.HexColor("#eef3fd"), border_width=0.75)


def flow_diagram(steps):
    """A simple vertical text-arrow flow diagram, one splittable Paragraph."""
    lines = []
    for i, s in enumerate(steps):
        lines.append(f"<b>{s}</b>")
        if i < len(steps) - 1:
            lines.append("&#8595;")
    html = "<br/>".join(lines)
    _boxed_paragraph(html, BORDER, LIGHT_BG, border_width=0.75, alignment=TA_CENTER, font_size=10, leading=17)


def populate_content():
    story.clear()

    # ---------------------------------------------------------------------------
    # COVER PAGE
    # ---------------------------------------------------------------------------

    story.append(Spacer(1, 40 * mm))
    story.append(Paragraph('<font color="white">COMMERCE OS</font>', ParagraphStyle(name="c1", parent=styles["CoverTitle"], textColor=colors.white)))
    story.append(Paragraph('<font color="white">OWNER\'S MANUAL</font>', ParagraphStyle(name="c2", parent=styles["CoverSubtitle"], textColor=colors.white, fontSize=18)))
    story.append(Spacer(1, 30 * mm))
    story.append(Paragraph("A Complete Guide to Understanding, Operating and Managing Your Automated Commerce System", styles["CoverTag"]))
    story.append(Spacer(1, 16 * mm))
    story.append(Paragraph(f"Generated {GENERATED_ON}", styles["CoverMeta"]))
    story.append(Paragraph(f"Documents commit <b>{COMMIT_HASH}</b> plus the Live Channel Compliance &amp; Readiness milestone, committed alongside this document", styles["CoverMeta"]))
    story.append(Paragraph("Generated from the current Commerce OS repository", styles["CoverMeta"]))
    spacer(10)
    warning_box(
        "Before you rely on anything in this document",
        [
            "Every capability below is labelled with its real status: LIVE VERIFIED, IMPLEMENTED, PARTIALLY IMPLEMENTED, DEMO ONLY, NOT IMPLEMENTED, BLOCKED, or PLANNED.",
            "Anything not marked LIVE VERIFIED should not be assumed to work against your real store, marketplace account, or money — treat it as unproven until it is.",
            "This document describes the actual current state of Commerce OS at the time of generation, not an aspiration.",
        ],
    )
    story.append(NextPageTemplate("normal"))
    story.append(PageBreak())

    # ---------------------------------------------------------------------------
    # TABLE OF CONTENTS
    # ---------------------------------------------------------------------------

    story.append(Paragraph("Table of Contents", styles["PartHeading"]))
    body("Page numbers below are generated automatically from this document's real pagination — nothing here is guessed or hand-typed.")
    spacer(6)
    story.append(toc)
    story.append(PageBreak())

    # ===========================================================================
    # PART 1 — EXECUTIVE OVERVIEW
    # ===========================================================================

    part("Part 1 — Executive Overview")

    body("Commerce OS is a piece of software you own that helps you run an ecommerce business — specifically a low-budget, dropshipping-style business where you sell products online without holding large amounts of stock yourself. It watches your products, your suppliers, and your marketplaces (Shopify, Amazon, eBay), works out whether a product is actually profitable once every real cost is accounted for, checks whether it is allowed to be sold on a given channel, and tells you what it recommends — but it does not spend your money or place orders without you.")

    body("The problem it solves is a common one for a small operator: it is very easy to lose money on ecommerce without realising it, because the real costs (marketplace fees, payment processing, shipping, returns, advertising) are scattered across many places and easy to under-count. Commerce OS puts every one of those costs through a single, consistent calculation, so a “profitable-looking” product that is actually losing money on Amazon's fees, or would need much more advertising spend to work on Shopify, gets caught before you commit real money to it.")

    sub("The business model this is built for")
    body("Commerce OS is deliberately built around a specific, conservative way of trading, not a generic “ecommerce platform”:")
    bullets([
        "<b>Dropshipping first.</b> The normal flow is: a customer orders, and only then do you buy the item from your supplier — you are not expected to buy inventory speculatively and store it.",
        "<b>No large stock commitments.</b> Nothing in Commerce OS calculates a bulk-purchase recommendation or a reorder-in-advance workflow. Purchasing happens per order, after a real customer has paid.",
        "<b>Start small, grow deliberately.</b> The system is meant to help you validate smaller, lower-risk products first, and only increase automation and scale as your own confidence and cash flow allow — it does not push you toward volume.",
        "<b>Human is the spending authority.</b> At every point where real money would move — buying from a supplier, changing a price, issuing a refund — a person (you, or someone you’ve given write access to) is the one who actually does it or approves it. Commerce OS prepares the information and, in some places, prepares the action, but does not spend on its own.",
    ])

    sub("The central principle: facts, then rules, then decisions, then controlled actions")
    flow_diagram(["FACTS", "DETERMINISTIC RULES &amp; GATES", "REASONING", "RECOMMENDATION", "OPERATOR DECISION / ACTION", "AUDITED STATE CHANGE"])
    body("Every important judgement Commerce OS makes follows this same chain, and it is worth understanding once because it explains almost everything else in this manual:")
    numbered([
        "<b>Facts</b> — real data: what a supplier charges, what a marketplace's fees are, what identifiers a product has on file, what your own configured limits are. Facts are never guessed. Where a fact genuinely is not available, the system says so explicitly rather than filling in a plausible-looking number.",
        "<b>Deterministic rules and gates</b> — fixed, code-based logic (never an AI model) that turns facts into a pass/fail verdict: is this profitable enough, is this compliant enough, is this supplier capable enough. “Deterministic” means the same facts always produce the same answer — nothing here is a judgement call the software makes up on the spot.",
        "<b>Reasoning</b> — the individual checks that were actually run, and whether each one passed, failed, or could not be assessed, shown to you in plain terms.",
        "<b>Recommendation</b> — a single, plain-English verdict (SELL, WATCH, HOLD, REVIEW, or REMOVE) derived entirely from the reasoning above. A recommendation is advice, never an action.",
        "<b>Operator decision / action</b> — you (or someone with permission) choose what actually happens: change a product's status, record a real purchase you made, approve a proposed price change.",
        "<b>Audited state change</b> — whatever actually changes is written to the database and permanently logged: who did it, when, why, and what changed. This record can never be edited or deleted, even by Commerce OS itself.",
    ])

    sub("Where AI fits in")
    body("Commerce OS includes an AI chat assistant (Commerce Intelligence, built on Anthropic's Claude). It can read your real data and explain it, summarise what needs attention, and draft a proposal for a change. It cannot place an order, change a price, issue a refund, or take any other consequential action by itself — this is not a policy choice that could be quietly changed, it is a structural fact about how the code is written: the AI is never given the technical ability (“tool access”) to call any of those functions directly. The furthest the AI can go on its own is to create a <i>pending approval</i> that a human then has to approve. Part 3 and Part 11 explain this in full technical and plain-English detail.")

    story.append(PageBreak())

    # ===========================================================================
    # PART 2 — SYSTEM MAP
    # ===========================================================================

    part("Part 2 — System Map")
    sub("How the major parts connect")

    flow_diagram([
        "SUPPLIERS", "PRODUCT INTELLIGENCE (discovery, scoring, opportunities)",
        "PROFITABILITY  /  COMPLIANCE  /  CHANNEL READINESS",
        "PRODUCT DECISION  (add / block / test / watch / hold / remove / review)",
        "CHANNEL DECISION  (same, per marketplace)",
        "DETERMINISTIC RECOMMENDATION  (SELL / WATCH / HOLD / REVIEW / REMOVE)",
        "PUBLICATION GATE  (all requirements checked together)",
        "SHOPIFY  /  AMAZON  /  EBAY",
        "CUSTOMER ORDERS",
        "PURCHASE QUEUE  (you buy from the supplier)",
        "SHIPMENT  →  DELIVERY",
        "ANALYTICS  /  CEO DASHBOARD",
    ])

    body("A note on how to read this diagram: it shows the order information generally flows in, not a claim that every arrow is fully automated end-to-end today. Some steps (supplier assessment, profitability, compliance, decisions, recommendations, the purchase queue) are real and working against your actual data once Supabase is connected. Others (automatically discovering new products from real suppliers, automatically publishing a listing) exist as engines and interfaces but are not yet fed by a live, connected data source — this is explained precisely, area by area, in Part 5 and the Capabilities Matrix in Part 12.")

    sub("Central Intelligence — one set of engines, read from everywhere")
    body("A deliberate design choice worth understanding: there is only <b>one</b> profitability calculator, <b>one</b> compliance engine, <b>one</b> supplier-scoring engine, and <b>one</b> publication gate in the whole system. The CEO dashboard, the chat assistant, the opportunities page, and the channel decision panel all call the exact same underlying functions rather than each having their own copy. This matters practically: a number you see on the dashboard and a number the AI assistant quotes back to you in chat are guaranteed to be calculated the same way, because they are, literally, the same code.")

    sub("How information actually flows")
    bullets([
        "<b>Supplier data</b> (what a supplier charges, how reliable they are, what they can and can't do) is entered by you or gathered from a connected supplier source, and feeds both product profitability and the compliance/capability checks.",
        "<b>Marketplace data</b> (a product's price, stock, and orders on Shopify/Amazon/eBay) is read from each marketplace's own API through a dedicated connector for that marketplace — never invented if the connector isn't actually connected.",
        "<b>Decisions</b> you make (product-level and channel-level) are stored permanently and are read by every downstream gate — a blocked decision is checked before profitability, compliance, or anything else, so it can never be bypassed by something else looking fine.",
        "<b>Orders</b> that arrive from a connected marketplace are recorded, and Commerce OS works out which supplier should fulfil each one and what it should cost — then waits for you to actually buy it and tell the system what happened.",
        "<b>Everything consequential</b> — a decision change, a recorded purchase, a shipment, a delivery — is written to an audit log that nothing in the system, including Commerce OS itself, can edit or delete afterwards.",
    ])

    story.append(PageBreak())

    # ===========================================================================
    # PART 3 — HOW THE SYSTEM MAKES DECISIONS
    # ===========================================================================

    part("Part 3 — How the System Makes Decisions")

    sub("Product decisions vs. channel decisions", index_term="Product Decision")
    story.append(IndexMark("Channel Decision"))
    body("Commerce OS separates two related but genuinely different controls, and understanding the difference matters:")
    bullets([
        "<b>Product decision</b> — your overall stance on a product, across the whole business: <b>Add</b>, <b>Block</b>, <b>Test</b>, <b>Watch</b>, <b>Hold</b>, <b>Remove</b>, or <b>Review</b>. This is checked first, ahead of everything else, for every channel.",
        "<b>Channel decision</b> — the same seven values, but set independently for Shopify, Amazon UK, and eBay. A product can genuinely be <b>Add</b> overall while <b>Block</b> on Amazon specifically — for example, if Amazon's referral fee makes the margin unworkable even though Shopify's lower fees make it fine.",
    ])
    note_box([
        "New products, and new product/channel combinations, default to <b>Review</b> — never to Add. Nothing is ever approved by default; you have to actively decide it's allowed to proceed.",
    ])

    sub("SELL / WATCH / HOLD / REVIEW / REMOVE — the recommendation")
    body("Separately from the decision you set, Commerce OS calculates its own <b>recommendation</b> for each product/channel combination, using the SELL/WATCH/HOLD/REVIEW/REMOVE vocabulary. The recommendation is entirely derived from the same deterministic checks described below — it is advisory, it is never written anywhere as a real decision, and it never changes anything by itself.")
    data_table(
        ["Recommendation", "What it means"],
        [
            [status_badge("SELL", "positive"), "Every requirement Commerce OS checked has passed. This is the only recommendation that means “ready to go”."],
            [status_badge("WATCH", "neutral"), "You have explicitly set the decision to Watch — you're monitoring this product/channel but haven't approved it to sell yet."],
            [status_badge("HOLD", "caution"), "You have explicitly set the decision to Hold or Block — you've paused or stopped this deliberately."],
            [status_badge("REVIEW", "caution"), "Either you haven't made a decision yet (defaults to Review), or something Commerce OS checked — profitability, compliance, supplier status, lifecycle — failed or could not be assessed. This is deliberately the default outcome for anything uncertain."],
            [status_badge("REMOVE", "negative"), "You have explicitly set the decision to Remove."],
        ],
        [30 * mm, 128 * mm],
    )
    note_box([
        "REVIEW is the deliberately conservative default. Commerce OS never turns an incomplete or failed check (missing compliance data, a supplier that can't be assessed, a profitability calculation it couldn't complete) into REMOVE or HOLD on its own — it only ever recommends REMOVE or HOLD when that matches a decision you actually made. An unclear situation always lands on REVIEW, asking you to look, never on an assumption in either direction.",
    ])

    sub("The publication gate — every requirement checked together")
    body("Behind every recommendation is the <b>publication gate</b>, which checks a fixed, ordered list of requirements for a specific product on a specific channel. Every requirement must pass for the recommendation to be SELL; if even one fails, the gate is blocked and the reason is shown to you by name — never a vague “no”.")
    data_table(
        ["Order", "Requirement", "What it checks"],
        [
            ["1", "Product decision", "Your overall decision for this product (checked first, always)."],
            ["2", "Channel decision", "Your decision for this specific channel (checked second, independently of #1)."],
            ["3", "Lifecycle", "Whether the product's own stage (e.g. approved, paused, declining) allows listing at all."],
            ["4", "Supplier status", "Whether a supplier has actually been assessed for this channel."],
            ["5", "Supplier fulfilment capability", "Whether that supplier can actually meet this channel's requirements (e.g. Amazon needs blind shipping and invoicing in your name)."],
            ["6", "Profitability", "Whether the product clears your configured minimum margin on this channel's real fee structure."],
            ["7", "Compliance", "Whether the product passes the checks Commerce OS can actually perform for this channel (Part 8 covers this in full)."],
            ["8", "Identifiers", "Whether required product identifiers (e.g. a GTIN/EAN for Amazon) are on file."],
            ["9", "Automation permission", "Only reached once every requirement above passes — decides whether the result can proceed automatically or needs your approval, based on your configured automation level."],
        ],
        [16 * mm, 46 * mm, 96 * mm],
    )

    sub("Deterministic vs. AI-advisory — the distinction that keeps this safe")
    body("Every requirement above is <b>deterministic</b>: fixed logic, the same inputs always produce the same output, and none of it involves an AI model making a judgement call. This is a deliberate choice for anything that gates a real decision. AI is used elsewhere in Commerce OS — summarising, explaining, drafting — but never inside this chain. The AI chat assistant can look at the same facts and explain them to you in conversation, and it can propose a change for you to approve, but it cannot itself set a decision, change what the gate returns, or skip a failed requirement.")

    story.append(PageBreak())

    # ===========================================================================
    # PART 4 — PRODUCT LIFECYCLE
    # ===========================================================================

    part("Part 4 — Product Lifecycle")
    body("This is the realistic, current journey a product takes through Commerce OS — not an idealised future version. Each step says plainly whether it's automatic, manual, or a mix, and what would stop it.")

    data_table(
        ["#", "Step", "Automatic / Manual", "What happens"],
        [
            ["1", "Product discovered", "Manual today", "There is a real, tested opportunity-scoring engine, but no connected live research source is feeding it yet — in live mode this list is currently empty until a real source is connected. You add candidate products yourself for now."],
            ["2", "Product information collected", "Manual", "Title, description, category, brand, and identifiers (GTIN/UPC/EAN etc.) are entered against the product record."],
            ["3", "Supplier assessed", "Automatic once entered", "Once a supplier and its cost/capability details are on file, Commerce OS automatically scores it (cost, delivery, reliability, quality, returns, tracking, compliance) — weighted so cost alone never wins; delivery and reliability count for more."],
            ["4", "Costs calculated", "Automatic", "Real supplier cost, shipping, and each channel's actual fee structure (different for Shopify vs Amazon) are combined into one profitability figure per channel."],
            ["5", "Profitability assessed", "Automatic", "Checked against your configured minimum margin. A product can pass on one channel and fail on another."],
            ["6", "Compliance assessed", "Automatic, per channel", "Checks whatever Commerce OS genuinely has data for (identifiers, IP/brand risk, blocked categories, any compliance documents on file) — see Part 8. Anything it cannot check is reported as not assessed, never as a pass."],
            ["7", "Product decision created", "Manual (you)", "You set Add / Block / Test / Watch / Hold / Remove / Review for the product overall. Defaults to Review."],
            ["8", "Channel-specific assessment", "Automatic", "The full requirement chain above runs independently for Shopify, Amazon UK, and eBay."],
            ["9", "Channel decision created", "Manual (you)", "You set the same seven values per channel, independently of the product-level decision."],
            ["10", "Publication gate checked", "Automatic", "All nine requirements are evaluated together; the result is SELL only if every one passes."],
            ["11", "Listing prepared / published", "Not implemented for any channel yet", "No connector in this system currently writes a listing to Shopify, Amazon, or eBay — every connector's write capability is either disabled by design or an honest stub. This is the single biggest gap between “SELL recommended” and “live on a marketplace” today."],
            ["12", "Performance monitored", "Automatic, once orders exist", "Revenue, margin, and channel performance are calculated from real order data as it arrives."],
            ["13", "Decision potentially changed", "Manual (you)", "You can change a product's or channel's decision at any time; every change is recorded permanently."],
            ["14", "Product removed or paused", "Manual (you)", "Setting the decision to Remove or Hold is how this happens — there is no automatic removal."],
        ],
        [8 * mm, 40 * mm, 30 * mm, 80 * mm],
    )

    story.append(PageBreak())

    # ===========================================================================
    # PART 5 — MARKETPLACE AND INTEGRATION GUIDE
    # ===========================================================================

    part("Part 5 — Marketplace and Integration Guide")

    sub("Shopify", index_term="Shopify")
    body(status_badge("LIVE VERIFIED", "positive") + " for connection, login, product listing, and stock reading.")
    data_table(
        ["Question", "Answer"],
        [
            ["Connected?", "Yes — real store credentials are configured and have been used successfully."],
            ["Live verified?", "Connectivity, authentication, reading listings, and reading inventory — yes, confirmed against your real store (one real product, real price and stock read back correctly)."],
            ["What can currently be read?", "Products/listings, inventory levels, and orders (the order-reading code is real and connects successfully, but has not yet been checked against a real order, because your store had none at the time of writing)."],
            ["What can currently be written?", "Nothing. Every write capability (changing price, changing stock, changing listing status, pushing tracking) is deliberately switched off in this connector's capability settings — not attempted, not partially working, off."],
            ["How would I know if it stopped working?", "The Marketplaces page reports a connection status derived from a real, fresh check every time — it only ever says “connected” after a real successful request, never just because credentials exist."],
        ],
        [45 * mm, 113 * mm],
    )
    small("Technical basis: Shopify's modern GraphQL Admin API with an app-based (client-credentials) sign-in — the older static access-token method Shopify has been phasing out is not used.")

    sub("Amazon", index_term="Amazon")
    body(status_badge("IMPLEMENTED — NOT LIVE VERIFIED", "caution") + " — real code exists, but it has never been run against a real Amazon Seller account, because no such account is configured in this environment.")
    data_table(
        ["Question", "Answer"],
        [
            ["Connected?", "No — the required Amazon credentials are not configured."],
            ["Live verified?", "No. Nothing about this connector has ever made a real request."],
            ["What is implemented, ready to test?", "Real sign-in code (Amazon's login system), real product-listing and order-reading calls, and a real signed-request mechanism Amazon requires (AWS-style request signing). This is genuine, working code — just never exercised against a live account."],
            ["What is explicitly NOT implemented?", "Reading current stock levels and fee data; every write action (changing price, changing stock, changing listing status) honestly returns “not supported” rather than pretending to work — this was a deliberate choice made because guessing at Amazon's exact required data format without a real account to test against would risk silently corrupting a real listing."],
            ["What would it take to go live?", "A registered Amazon Seller account and Amazon developer application, with its credentials added to this system's configuration — followed by a genuine test run before it is ever trusted."],
        ],
        [50 * mm, 108 * mm],
    )

    sub("eBay", index_term="eBay")
    body(status_badge("BLOCKED", "negative") + " — do not treat eBay as connected.")
    data_table(
        ["Question", "Answer"],
        [
            ["Connected?", "No. Sign-in currently fails."],
            ["What's blocking it?", "eBay's Sandbox sign-in system is rejecting the refresh token this system is given, with the error “issued to another client.” Every configuration item that could plausibly be wrong on our side — the correct app credentials, the correct sign-in mode, the correct permissions, the correct sandbox environment, a freshly generated token used immediately — has been checked and ruled out."],
            ["What's been done about it?", "An eBay Developer Support ticket is open: <b>#260827-000029</b>. This is now waiting on eBay, not on further configuration changes here."],
            ["What is implemented, ready once unblocked?", "Real sign-in code, real order- and listing-reading calls, and a real (informational-only) tracking-number push — none of it has ever completed a successful request, because sign-in itself has never succeeded."],
            ["What should I do?", "Nothing, for now. Do not attempt to “fix” this by changing credentials again — the specific, narrowed cause is with eBay's own support team. Treat eBay as unavailable until this manual (or a direct update) says otherwise."],
        ],
        [42 * mm, 116 * mm],
    )

    sub("Supabase — the database behind everything", index_term="Supabase")
    body("Supabase is the real database and login system this entire application is built on (it runs on PostgreSQL, a very widely used, robust database engine). It provides three things: <b>storage</b> for every product, supplier, order, decision, and audit record; <b>authentication</b> — who you are when you log in; and <b>security enforcement</b> — a feature called Row Level Security, explained fully in Part 11, which makes it physically impossible for one business's data to leak into another's, and restricts who can change what, at the database level itself, not just in the app's own code.")
    body("If Supabase is not configured (no real project connected), Commerce OS runs in <b>Demo Mode</b> instead: a synthetic, clearly-labelled preview using realistic but entirely made-up data, so you can explore every screen before connecting anything real. Nothing in demo mode is ever presented as real, and no real action (a purchase record, a decision change, a shipment) can be saved while in demo mode.")

    sub("AI / Anthropic")
    body("The chat assistant is built on Anthropic's Claude (currently Claude Sonnet 5). Its role is strictly <b>advisory</b>: reading your real data (via the exact same functions the dashboard uses) and explaining it, and drafting a proposal for you to send for approval. It genuinely cannot publish a listing, change a price, purchase anything, issue a refund, or move money — the code that sends requests to the AI model never gives it the technical means to call any function that would do those things, and separately, any price-related suggestion it does draft is always forced through the strictest, most conservative approval setting regardless of your actual configured automation level. If no AI account is configured, the chat still works using a built-in, deterministic fallback for common questions rather than failing outright.")

    story.append(PageBreak())

    # ===========================================================================
    # PART 6 — DAILY OPERATING INSTRUCTIONS
    # ===========================================================================

    part("Part 6 — Daily Operating Instructions")
    body("This is a practical, step-by-step manual for actually running Commerce OS day to day, based on the screens and buttons that genuinely exist right now.")

    sub("Starting the day")
    numbered([
        "Open Commerce OS and go to the home dashboard.",
        "Read the “What needs your attention” panel at the top — this is a deterministic priority list (loss-making products, compliance failures, stale automation, pending approvals), not a suggestion engine, so it is worth reading first every time.",
        "Check “Business health” — eight areas (financial, product, supplier, marketplace, fulfilment, compliance, automation, data quality), each with its own honest status. The overall status shown is always the worst of the eight, never a blended, flattering average.",
        "Check “Automation health” — whether automation is currently paused, how many actions ran today, and whether anything failed.",
        "Check “Approvals awaiting you” — anything the system has proposed but not yet acted on.",
        "Check the Purchase Queue (see below) for anything waiting on a real-world purchase, shipment, or delivery confirmation.",
        "Check the Marketplaces page for each channel's real connection status.",
    ])

    sub("Reviewing products")
    numbered([
        "Go to Products, and open the specific product.",
        "The “Product” card shows what Commerce OS actually knows: SKU and lifecycle stage.",
        "The “Commerce-OS decision” card shows the current product-wide decision, who changed it and when, and the reason given.",
        "Below that, “Channel decisions” shows one card per marketplace, each with: the deterministic recommendation (SELL/WATCH/HOLD/REVIEW/REMOVE), the full list of checks behind it with a tick, cross, or question mark for each, the compliance status specifically, and the current channel decision.",
        "To change a decision: pick the new value from the dropdown, optionally add a short reason, and press Save. This writes immediately and is recorded permanently — there is no “are you sure” confirmation step for this specific action because it never lists, prices, or spends anything by itself, it only changes an internal control that other checks read.",
    ])
    warning_box("When NOT to approve a product", [
        "If the recommendation shows REVIEW or HOLD because a real check (profitability, compliance, supplier capability) failed — read the reason before overriding it. Setting the decision to Add does not fix the underlying problem; it only tells Commerce OS you're choosing to proceed anyway.",
        "If compliance shows NOT ASSESSED for something that matters for this specific product (for example, you know it contains a lithium battery), be aware Commerce OS currently cannot check that automatically — the judgement is genuinely yours to make.",
    ])

    sub("Reviewing channel decisions")
    body("This is part of the same product page described above — there is no separate screen. For each of Shopify, Amazon UK, and eBay you can see the recommendation, the full reasoning chain, the compliance panel, and a form to save a new decision for that channel specifically. Remember a channel decision never overrides the product-level one or vice versa — both are checked, and either one alone can block a channel.")

    sub("Managing orders — the Purchase Queue")
    body("Go to Orders. The “Purchase queue” section lists every order fulfilment currently waiting on you, and moves through these states as you record what you actually did:")
    flow_diagram(["AWAITING SUPPLIER  →  you record the purchase", "SUBMITTED  →  you record the shipment", "SHIPPED  →  you confirm delivery", "DELIVERED"])
    body("Important: none of these buttons ever buy anything, contact a supplier, or move money by themselves. Each one only records a real-world action you already took, after the fact:")
    numbered([
        "<b>Record purchase</b> — after you have actually bought the item from your supplier, enter what you paid (item cost and shipping separately) and the supplier's own order reference, then save. This moves the fulfilment to Submitted and recalculates the order's real cost from what you actually paid.",
        "<b>Record shipment</b> — once the supplier ships it (or you ship it), enter the carrier and tracking number. This moves the fulfilment to Shipped.",
        "<b>Confirm delivery</b> — once it has arrived, press Confirm delivery. This moves the fulfilment to Delivered, and if every fulfilment on that order is now delivered, the whole order is marked delivered too.",
    ])

    sub("When a customer places an order")
    flow_diagram([
        "CUSTOMER ORDERS ON SHOPIFY / AMAZON / EBAY",
        "Commerce OS records the order (where the connector's order-reading is live)",
        "You check the Purchase Queue",
        "You buy the item from your supplier, yourself",
        "You record the purchase in Commerce OS",
        "Supplier ships the item",
        "You record the tracking/shipment in Commerce OS",
        "Customer receives the product",
        "You confirm delivery in Commerce OS",
    ])
    note_box([
        "Automatic order recording from a live marketplace depends on that marketplace's connector actually reading orders successfully and on the scheduled background job that ingests them — this exists and runs every 15 minutes, but has only genuinely been proven end-to-end once a real order exists to test it against (see Part 5, Shopify).",
    ])

    sub("End-of-day checklist")
    bullets([
        "Anything left in the Purchase Queue that needs a purchase, shipment, or delivery recorded today?",
        "Any pending approvals still waiting on you?",
        "Any product stuck on REVIEW or HOLD that you now have enough information to resolve?",
        "Any marketplace showing a connection problem?",
        "Any automation failures shown on the dashboard?",
    ])

    story.append(PageBreak())

    # ===========================================================================
    # PART 7 — BUTTON-BY-BUTTON GUIDE
    # ===========================================================================

    part("Part 7 — Button-by-Button Guide", )
    story.append(IndexMark("Buttons"))
    body("Every button described below is real and genuinely wired to a real backend action — none is decorative. If a button that would be useful doesn't exist yet (for example, a “Publish to Shopify” button), it has been left out deliberately, on the basis that a button which looks like it does something but doesn't would be worse than no button at all.")

    subsub("Screen: Product detail (/products/[id])")
    data_table(
        ["Button", "What happens", "Changes real data?", "Reversible?", "Who can use it"],
        [
            ["Save decision", "Sets the product-wide decision (Add/Block/Test/Watch/Hold/Remove/Review) and records why.", "Yes — writes the product's decision, keeps permanent history, logs an audit entry.", "Yes — set it again to change it. The full history is always kept.", "Owner or Admin only"],
            ["Save {channel} decision (×3, one per marketplace)", "Sets the decision for that one channel only.", "Yes — same as above, scoped to one channel.", "Yes", "Owner or Admin only"],
        ],
        [30 * mm, 55 * mm, 33 * mm, 22 * mm, 18 * mm],
    )

    subsub("Screen: Orders — Purchase Queue (/orders)")
    data_table(
        ["Button", "What happens", "Moves money?", "Places a supplier order?", "Audited?"],
        [
            ["Record purchase", "Saves the actual cost and shipping you paid, plus the supplier's order reference, for an order awaiting a supplier purchase.", "No — records money you already spent elsewhere.", "No.", "Yes"],
            ["Record shipment", "Saves the carrier and tracking number for an order you've purchased.", "No.", "No.", "Yes"],
            ["Confirm delivery", "Marks the order delivered.", "No.", "No.", "Yes"],
        ],
        [28 * mm, 70 * mm, 26 * mm, 30 * mm, 4 * mm],
    )

    subsub("Screen: Approvals (/approvals)")
    data_table(
        ["Button", "What happens", "Who can use it"],
        [
            ["Approve", "Executes the specific proposed action (e.g. a price change) that was pending — using the same deterministic checks as everywhere else, never on trust alone.", "Owner only"],
            ["Reject", "Cancels the proposed action. Nothing happens.", "Owner or Admin"],
        ],
        [26 * mm, 108 * mm, 24 * mm],
    )

    subsub("Screen: Automation (/automation)")
    data_table(
        ["Button", "What happens", "Who can use it"],
        [
            ["Pause all", "Immediately stops every category of automated action across the whole business.", "Owner or Admin"],
            ["Resume all", "Turns automation back on.", "Owner or Admin"],
            ["Toggle category (publishing / pricing / supplier switching / supplier ordering / refunds / fulfilment)", "Pauses or resumes just that one category, independently of the others.", "Owner or Admin"],
        ],
        [55 * mm, 71 * mm, 32 * mm],
    )

    subsub("Chat (Commerce Intelligence)")
    data_table(
        ["Control", "What happens", "Moves money or publishes anything?"],
        [
            ["Request approval", "Creates a real, trackable pending approval from the AI's draft proposal, for you to review on the Approvals screen.", "No — this is the escalation step, not the action itself."],
        ],
        [30 * mm, 78 * mm, 50 * mm],
    )

    story.append(PageBreak())

    # ===========================================================================
    # PART 8 — AUTOMATION VS HUMAN RESPONSIBILITY
    # ===========================================================================

    part("Part 8 — Automation vs. Human Responsibility")
    data_table(
        ["Task", "Automatic", "Requires you", "Currently disabled", "Not implemented"],
        [
            ["Product discovery", "", "Yes — you add candidates", "", "No live research source connected yet"],
            ["Supplier scoring", "Yes, once data is on file", "", "", ""],
            ["Profitability analysis", "Yes", "", "", ""],
            ["Compliance assessment", "Yes, for what data exists", "You supply missing facts", "", "Some checks (battery/electrical/childrens/food/cosmetic flags) have nowhere to be entered yet"],
            ["Product decision", "", "Yes, always", "", ""],
            ["Channel decision", "", "Yes, always", "", ""],
            ["Recommendation (SELL/WATCH/HOLD/REVIEW/REMOVE)", "Yes", "", "", ""],
            ["Publishing a listing", "", "", "", "No connector currently writes a listing to any marketplace"],
            ["Price changes", "Proposed only, at cautious automation levels", "Approval, at most levels", "Fully autonomous price changes, unless you deliberately configure that level", ""],
            ["Inventory changes", "", "", "", "No connector currently writes stock to any marketplace"],
            ["Customer order ingestion", "Yes, every 15 minutes, where a connector reads orders", "", "", ""],
            ["Supplier purchasing", "", "Yes, always — you buy, then record it", "Autonomous purchasing, entirely", ""],
            ["Shipment recording", "", "Yes, always", "", ""],
            ["Delivery confirmation", "", "Yes, always", "", ""],
            ["Refunds", "Proposed only", "Approval, always in practice today", "Autonomous refunds beyond a tiny configured limit", ""],
            ["Advertising decisions", "Recommended only", "Approval to execute", "No pause/budget button exists in the UI at all yet", ""],
            ["Marketplace connection monitoring", "Yes", "", "", ""],
        ],
        [40 * mm, 34 * mm, 30 * mm, 32 * mm, 24 * mm],
    )

    story.append(PageBreak())

    # ===========================================================================
    # PART 9 — WHAT TO DO WHEN SOMETHING GOES WRONG
    # ===========================================================================

    part("Part 9 — What To Do When Something Goes Wrong")
    body("This part is a troubleshooting reference. For each situation: what it means, likely causes, what to check, what is safe to do yourself, what NOT to do, and when to bring in technical help.")

    def trouble(title, meaning, causes, check, safe, avoid, escalate):
        subsub(title)
        body(f"<b>What it means:</b> {meaning}")
        body("<b>Likely causes:</b>")
        bullets(causes)
        body("<b>What to check:</b>")
        bullets(check)
        body(f"<b>Safe to do yourself:</b> {safe}")
        warning_box("Do NOT", [avoid])
        body(f"<b>When technical help is required:</b> {escalate}")
        spacer(4)

    trouble(
        "Shopify connection shows a problem",
        "The dashboard's marketplace status for Shopify is not showing CONNECTED.",
        ["The store's access token or credentials in the server environment have expired, been revoked, or were never set.", "Shopify's API is temporarily unavailable (rare)."],
        ["The Marketplace status panel on the dashboard for the exact wording of the error.", "Whether this just started, or has been this way for a while."],
        "Note the exact status shown and when it started; nothing else to do from the UI.",
        "Do not re-enter or guess at API keys yourself, and never paste a credential into chat, a ticket, or any AI tool.",
        "Any time this shows anything other than CONNECTED — this always needs a developer with access to the hosting environment's variables.",
    )

    trouble(
        "eBay connection shows a problem",
        "eBay is expected to show BLOCKED at the moment.",
        ["A confirmed, already-escalated issue with eBay's own Sandbox authorization service — not a Commerce OS bug and not a configuration mistake (this was proven by exhausting every internal cause first)."],
        ["That the status still references support ticket #260827-000029."],
        "Nothing — this is being tracked externally.",
        "Do not attempt to fix this by regenerating or re-pairing eBay credentials again — this exact approach was tried repeatedly and conclusively did not fix it.",
        "Only when eBay Developer Support responds to the open ticket.",
    )

    trouble(
        "Amazon connection shows a problem",
        "The dashboard's marketplace status for Amazon is not showing CONNECTED.",
        ["Amazon has never actually been verified against a real Amazon Seller account in this system — the connector is built and unit-tested against Amazon's documented API shape, but no real credentials have been tried yet."],
        ["Whether Amazon credentials have ever been entered into the environment at all."],
        "Nothing to do yourself.",
        "Do not assume Amazon is broken — it may simply never have been connected.",
        "When you're ready to actually sell on Amazon and have seller credentials to provide to a developer.",
    )

    trouble(
        "A product is stuck on HOLD or REVIEW",
        "The deterministic gate found at least one unmet requirement for that product/channel and is refusing to recommend selling it.",
        ["Missing or unprofitable pricing/cost data.", "Missing compliance information.", "No supplier assigned, or the supplier can't fulfil that channel's requirements.", "The operator decision itself is set to Hold or Review."],
        ["The channel card's \"Why\" list on the product page — every unmet requirement is listed with a plain-English reason, not just a status.", "The compliance panel underneath it for any BLOCKED or NOT ASSESSED checks."],
        "Supply the missing information (cost, compliance document, identifier) if you have it, or make the deliberate decision yourself if you've reviewed it.",
        "Do not treat REVIEW or HOLD as a bug to be worked around — it means the system genuinely does not have enough information or confidence to recommend selling.",
        "If the \"Why\" list references data that should exist but doesn't appear to be reachable (e.g. a cost you know is on file but isn't showing).",
    )

    trouble(
        "A channel decision looks wrong or won't save",
        "You tried to set a channel decision and either it didn't take effect, or the value shown doesn't match what you expect.",
        ["A permissions issue — only Owner/Admin roles can change decisions.", "A save that failed silently due to a network issue."],
        ["The confirmation message under the Save button after submitting.", "Your own role."],
        "Try again once; check the confirmation message.",
        "Do not repeatedly resubmit if it fails — note the exact error text instead.",
        "If the error message itself looks like a system error rather than a plain validation message.",
    )

    trouble(
        "Publication is blocked for a channel",
        "The publication gate (Part 3) has one or more failed requirements for that product on that channel.",
        ["Same causes as \"stuck on HOLD or REVIEW\" above — this is the same underlying check."],
        ["The requirements list on the product page."],
        "Address whichever requirement is failing.",
        "Do not expect a \"publish anyway\" override to exist — there isn't one, deliberately.",
        "Not usually required — this is working as designed.",
    )

    trouble(
        "An order is stuck in AWAITING SUPPLIER",
        "A customer order has come in and needs you to actually place and pay for the matching supplier purchase.",
        ["You haven't purchased from the supplier yet.", "You purchased but haven't recorded it in the Purchase Queue yet."],
        ["The Purchase Queue screen for this order's current stage."],
        "Purchase from the supplier yourself (outside Commerce OS, on the supplier's own site/platform), then use \"Record purchase\" to log it.",
        "Do not expect Commerce OS to place the supplier purchase for you — it never will, by design (see Part 8).",
        "If the order has been sitting for an unusually long time and you're unsure whether it was already actioned outside the system.",
    )

    trouble(
        "A supplier shows no stock",
        "The supplier's product offer indicates unavailable or insufficient stock.",
        ["Genuinely out of stock at the supplier.", "Stale supplier data that hasn't been refreshed."],
        ["The supplier's own platform directly, if you have access, for the true current stock."],
        "Consider setting the product's channel decision to Hold until stock returns, to avoid taking orders you can't fulfil.",
        "Do not leave a product marked to sell if you know the supplier is out of stock.",
        "If stock data appears to update automatically and is wrong — that would indicate a connector problem.",
    )

    trouble(
        "A product that used to be profitable no longer is",
        "The profitability gate is now failing where it previously passed.",
        ["Supplier cost increased.", "Marketplace fees changed.", "Your selling price changed.", "Advertising spend assumptions changed."],
        ["The channel card's profitability requirement detail, which states the specific reason."],
        "Adjust price, switch supplier, or set the decision to Hold/Remove as appropriate.",
        "Do not keep a product marked SELL once the system is telling you it no longer clears your configured margin threshold — that threshold exists to protect you.",
        "Not usually required — this is the system doing its job.",
    )

    trouble(
        "A marketplace API call is failing",
        "Errors appear related to a live call to Shopify, Amazon, or eBay.",
        ["Expired credentials.", "The marketplace's own API being temporarily down.", "A genuine bug."],
        ["Whether the issue is isolated to one marketplace or affects all of them (isolated points to that marketplace; all-at-once points to a shared cause)."],
        "Note what you observed and when.",
        "Do not attempt to fix API-level errors yourself.",
        "Always — this needs a developer to read the actual error and server logs.",
    )

    trouble(
        "Automation seems to have failed to do something",
        "An automated step you expected (e.g. a scheduled order check) doesn't appear to have run.",
        ["Automation for that category is paused (Part 6/8).", "A genuine failure in the scheduled job."],
        ["The Automation screen for whether that category is paused."],
        "Resume automation yourself if you find it was paused unintentionally.",
        "Do not assume a paused category is a bug — check first, since pausing is a deliberate safety control you or a colleague may have used.",
        "If automation is confirmed enabled but still isn't running.",
    )

    trouble(
        "The database or the app itself seems broken",
        "Pages fail to load, or show unexpected errors unrelated to any specific business decision.",
        ["A genuine software or infrastructure problem."],
        ["Whether the problem is on one page or the whole app."],
        "Nothing — do not attempt any technical fix yourself.",
        "Do not attempt to restart, reset, or modify anything in the underlying infrastructure yourself.",
        "Always — this is a developer/infrastructure issue.",
    )

    trouble(
        "An AI recommendation or chat answer looks wrong",
        "Something the AI assistant says doesn't match what you see elsewhere in the system, or seems mistaken.",
        ["The AI is advisory only and can be wrong — it has no special access to facts beyond what it's given, and never bypasses the deterministic engines described in Part 3."],
        ["The actual data on the relevant product/order/dashboard page — that is always the authoritative source, never the chat answer."],
        "Trust the deterministic screens (product, channel, dashboard) over a chat answer whenever they disagree; treat chat as a starting point for investigation, not a final answer.",
        "Do not act on an AI chat suggestion that would move money, change a live listing, or change a decision without checking the real screen first.",
        "If the AI is suggesting something that contradicts a hard safety rule in this manual — that's worth reporting to a developer as a possible bug.",
    )

    story.append(PageBreak())

    # ===========================================================================
    # PART 10 — CEO / OWNER DASHBOARD GUIDE
    # ===========================================================================

    part("Part 10 — CEO / Owner Dashboard Guide")
    story.append(IndexMark("Dashboard"))
    body("The dashboard (the app's home screen) is built almost entirely from live database queries — not estimates or mock numbers — with two clearly-noted exceptions below. Each panel is described in the order it appears on the page.")

    def dash_panel(title, meaning, source, why, action):
        subsub(title)
        body(f"<b>What it shows:</b> {meaning}")
        body(f"<b>Where the numbers come from:</b> {source}")
        body(f"<b>Why it matters:</b> {why}")
        body(f"<b>What action to consider:</b> {action}")
        spacer(4)

    dash_panel(
        "What needs your attention",
        "A ranked priority list of the most urgent things across the whole business right now.",
        "Live — assembled from current alerts, automation events, pending approvals, and compliance verdicts.",
        "This is designed to be the one list you check first each day.",
        "Work down the list in order; each item names its own recommended next step.",
    )
    dash_panel(
        "Executive summary",
        "Revenue, net revenue, orders, average order value, refunds, refund rate, return rate, known net margin.",
        "Live — calculated from the orders, order line items, and refunds tables.",
        "The headline numbers for the business.",
        "Watch for refund rate or return rate trending up — that's usually the first sign of a product or supplier problem.",
    )
    dash_panel(
        "Business health",
        "Nine tiles — Financial, Product, Supplier, Marketplace, Fulfilment, Compliance, Advertising, Automation, and Data quality — each shown as Healthy, Watch, At risk, or Critical.",
        "Live — a deterministic classification computed from the same underlying live facts as the other panels, not a separate invented score.",
        "A single at-a-glance read on where a problem exists, without having to read every panel in detail.",
        "Open any tile showing Watch, At risk, or Critical to see the specific reason underneath.",
    )
    dash_panel(
        "Channel performance",
        "Revenue, orders, known net profit, and average margin, broken down by Shopify / Amazon UK / eBay.",
        "Live — from orders and channel-listing data.",
        "Shows which marketplace is actually making money, not just which has the most orders.",
        "Consider a channel decision change (Part 3) for a channel that's consistently unprofitable.",
    )
    dash_panel(
        "Top performers / Problem products",
        "Two ranked lists — products earning the most realised revenue, and products currently losing money.",
        "Live — from products, channel listings, and supplier cost data.",
        "Surfaces winners worth doubling down on and losers worth reviewing quickly.",
        "For a problem product, open its product page and check the profitability requirement's detail.",
    )
    dash_panel(
        "Supplier health",
        "A status badge and reasons for each supplier.",
        "Live — from supplier product and connector data.",
        "An unreliable supplier is one of the most common causes of a channel going from SELL to REVIEW.",
        "Investigate suppliers not shown as healthy before relying on them for new products.",
    )
    dash_panel(
        "Supplier approval status",
        "A table of every supplier with their score and per-channel approval.",
        "Live — read directly from the suppliers table.",
        "A quick reference for which suppliers are cleared for which channel.",
        "Use this before assigning a supplier to a new product.",
    )
    dash_panel(
        "Fulfilment health",
        "Eight tiles — awaiting fulfilment, delivered, missing tracking, late deliveries, cancellation rate, on-time delivery, average dispatch time, unknown outcome.",
        "Live — from fulfilment and shipment records.",
        "Shows how well orders are actually being delivered, not just placed.",
        "Investigate a rising \"missing tracking\" or \"late deliveries\" count promptly — customers notice this first.",
    )
    dash_panel(
        "International markets",
        "A grid of markets/countries with a connector status badge for each.",
        "Live — from market readiness monitoring.",
        "Shows where the business is actually able to sell today versus not yet connected.",
        "Use this before promising delivery to a country not shown as ready.",
    )
    dash_panel(
        "Automation health",
        "Status, actions taken today, failed actions, and dead-lettered (permanently failed) jobs.",
        "Live — from the automation job queue and policy engine.",
        "The health of the background system that runs scheduled checks and proposals.",
        "A rising failed/dead-lettered count is a signal to bring in technical help (Part 9).",
    )
    dash_panel(
        "Approvals awaiting you",
        "Up to five pending items with an estimated impact for each.",
        "Live — from the approvals table.",
        "These are proposed actions genuinely waiting on a human decision — nothing here has happened yet.",
        "Review and approve or reject; see Part 7 for what each button does.",
    )
    dash_panel(
        "Opportunities",
        "Stat tiles (new opportunities, recommended for testing, one-channel-only, requiring review) plus top-candidate and trending lists.",
        "PLACEHOLDER in live use today: the underlying functions exist and are wired up, but genuinely return empty/zero for a live organisation because no live product-research data source has been connected yet. Only demo mode shows populated example data here.",
        "Not yet a source of real numbers for your business.",
        "Do not make sourcing decisions from this panel until it shows live data — check with a developer if it's expected to be live yet.",
    )
    dash_panel(
        "Can I trust these numbers?",
        "A direct data-quality readout explaining any known gaps or caveats behind the analytics shown elsewhere on the page.",
        "Live.",
        "This is the dashboard being honest about its own limitations, on purpose.",
        "Read this before making a big decision purely from the summary numbers.",
    )
    dash_panel(
        "Stock",
        "Stock alert list.",
        "PLACEHOLDER in live use today: this always returns an empty list for a live organisation — no live stock-monitoring query has been built yet. Only demo mode shows example alerts.",
        "Not a real signal yet.",
        "Do not rely on an empty Stock panel to mean stock is fine — it means this check isn't live yet. Verify stock directly with suppliers.",
    )
    dash_panel(
        "Compliance",
        "A list of open compliance issues.",
        "Live — read from the compliance records table, joined to products.",
        "A running list of compliance concerns that need a decision, separate from the per-channel compliance panel described in Part 3.",
        "Review and resolve open items regularly.",
    )
    dash_panel(
        "Recent business activity",
        "A combined timeline of real business events and automation actions.",
        "Live — from the domain events and automation actions tables.",
        "A genuine audit-style feed of what has actually happened.",
        "Use this to reconstruct \"what happened and when\" after any unexpected outcome.",
    )

    note_box([
        "When the dashboard is running in demo mode, illustrative scenario cards appear that are clearly labelled as demo/example content, not live business data. If you ever see one of those cards without a demo label, that itself would be a bug worth reporting.",
    ])

    story.append(PageBreak())

    # ===========================================================================
    # PART 11 — SECURITY AND SAFETY
    # ===========================================================================

    part("Part 11 — Security and Safety")

    sub("In plain English")
    body("Commerce OS is built so that the AI assistant can never itself spend money, publish a listing, or change a live price — it can only propose, and a human (or a narrow, pre-approved automatic rule you configured) has to actually approve or trigger the real action. Every action that changes real data is written down permanently, so there is always a record of who did what and when. Sensitive information like API keys and marketplace tokens are kept out of the codebase entirely and are never shown in the interface, logs, or AI conversations.")

    sub("Technical detail")
    data_table(
        ["Control", "What it means"],
        [
            ["Environment variables", "Secrets (API keys, tokens) live only in the server's environment configuration, never in the codebase itself."],
            ["API keys / refresh tokens", "Used only server-side to talk to Shopify/Amazon/eBay/Anthropic — never sent to the browser, never logged, never shown in the UI."],
            [".env.local must never be committed", "This file (used for local development) holds real secret values and is excluded from version control (.gitignore) — committing it would leak credentials into the project's history permanently."],
            ["Row Level Security (RLS)", "Database-enforced rules ensuring a user can only ever read or write data belonging to their own organisation, regardless of what the application code does."],
            ["Authentication", "Every user must sign in; every server action checks who is asking before doing anything."],
            ["Write permissions", "Certain actions (e.g. changing a decision) are restricted to Owner/Admin roles at the database level, not just hidden in the interface."],
            ["Read-only roles", "Some roles can view data without being able to change it."],
            ["Audit logs", "A permanent, append-only record of every state-changing action — who, what, when, and the before/after values."],
            ["Idempotency", "Actions are designed so that accidentally triggering the same action twice (e.g. a network retry) cannot cause it to happen twice in the real world."],
            ["Marketplace safety controls", "Automation levels, category pausing, and approval gates (Parts 3, 6, 8) that keep any automatic action within limits a human explicitly set."],
        ],
        [45 * mm, 111 * mm],
    )

    warning_box("Never do this", [
        "Never type an API key, password, or refresh token into the AI chat, a support ticket, or anywhere outside the one secure place it belongs.",
        "Never share a screenshot that shows a raw credential value.",
        "Never commit .env.local, or any file containing real secret values, to version control.",
        "Never ask the AI assistant to \"just try\" a purchase, refund, or listing change to see what happens — every real action should be a decision you're prepared to stand behind.",
        "Never disable Row Level Security or bypass the approval gates to \"save time\" — these exist specifically to contain mistakes.",
    ])

    story.append(PageBreak())

    # ===========================================================================
    # PART 12 — CURRENT CAPABILITIES MATRIX
    # ===========================================================================

    part("Part 12 — Current Capabilities Matrix")
    body("Legend: \U0001F7E2 Live verified against a real account &nbsp;&nbsp; \U0001F535 Implemented, not yet live-verified &nbsp;&nbsp; \U0001F7E1 Partially implemented &nbsp;&nbsp; \U000026AA Planned, not built &nbsp;&nbsp; \U0001F534 Blocked")
    data_table(
        ["Capability", "Status", "Automatic / Manual / Hybrid", "Live verified?", "Human action required?", "Notes"],
        [
            ["Shopify — read products/orders", "\U0001F7E2", "Automatic", "Yes", "No", "GraphQL Admin API, client-credentials"],
            ["Shopify — publish/update listings", "\U000026AA", "—", "No", "—", "No write connector built yet"],
            ["Amazon — read", "\U0001F535", "Automatic", "No", "No", "Built and unit-tested, no real seller account tried"],
            ["Amazon — write", "\U000026AA", "—", "No", "—", "Not built"],
            ["eBay — read", "\U0001F534", "Automatic", "No", "No", "Blocked on eBay-side OAuth issue, ticket #260827-000029"],
            ["eBay — write", "\U000026AA", "—", "No", "—", "Not built; policy-permitted level is read-only regardless"],
            ["Product decisions", "\U0001F7E2", "Manual", "Yes", "Yes, always", "Full history kept"],
            ["Channel decisions", "\U0001F7E2", "Manual", "Yes", "Yes, always", "Full history kept"],
            ["Deterministic recommendation (SELL/WATCH/HOLD/REVIEW/REMOVE)", "\U0001F7E2", "Automatic", "Yes", "No", "Derived from the publication gate, never a second engine"],
            ["Compliance assessment", "\U0001F7E1", "Automatic, for available data", "Yes", "Sometimes", "Category safety flags (battery/electrical/etc.) not yet tracked"],
            ["Profitability gate — Shopify/Amazon UK", "\U0001F7E2", "Automatic", "Yes", "No", ""],
            ["Profitability gate — eBay", "\U0001F7E1", "Automatic", "No", "No", "eBay fee schedule not yet verified against official docs"],
            ["Order ingestion", "\U0001F7E2", "Automatic, every 15 min", "Partially", "No", "Proven against demo data; not yet proven against a real order"],
            ["Purchase Queue (record purchase/shipment/delivery)", "\U0001F7E2", "Manual", "Yes", "Yes, always", ""],
            ["Automated supplier purchasing", "\U000026AA", "—", "No", "—", "Deliberately not built — see Part 8"],
            ["Automated refunds", "\U0001F7E1", "Hybrid — proposal only", "No", "Yes, in practice today", "Tiny auto-limit exists in config, unused in practice"],
            ["Advertising — pause/budget changes", "\U0001F535", "Hybrid — chat-executable with approval", "No", "Depends on automation level", "Not yet live-verified against a real ad account"],
            ["CEO dashboard analytics (revenue, channel, fulfilment, etc.)", "\U0001F7E2", "Automatic", "Yes", "No", "See Part 10"],
            ["Dashboard \"Opportunities\" panel", "\U0001F7E1", "Automatic", "No", "No", "Wired but returns empty for live orgs — see Part 10"],
            ["Dashboard \"Stock\" panel", "\U0001F7E1", "Automatic", "No", "No", "Wired but returns empty for live orgs — see Part 10"],
            ["AI chat assistant", "\U0001F7E2", "Manual trigger", "Yes", "N/A — advisory only", "Structurally cannot execute actions directly"],
        ],
        [46 * mm, 12 * mm, 26 * mm, 16 * mm, 22 * mm, 34 * mm],
    )

    story.append(PageBreak())

    # ===========================================================================
    # PART 13 — ROADMAP
    # ===========================================================================

    part("Part 13 — Roadmap")
    body("This reflects the project's own internal handover notes as of this document's generation date. It is a working plan, not a promise — priorities can and do change.")

    subsub("NEXT")
    bullets([
        "Wire advertising's product-linkage plumbing so a channel-level TEST decision can drive an advertising experiment classification — campaigns are not yet joined to products anywhere in that pipeline.",
        "Once the connected Shopify store has a real order (and matching supplier product records), re-run the pipeline end-to-end against real data for the first time — currently only proven against demo data and the pure decision logic.",
    ])

    subsub("LATER")
    bullets([
        "Extend the shared marketplace listing type with SKU/vendor/description/real-timestamp fields confirmed present on real Shopify products but currently uncaptured — touches every connector, so needs its own deliberate decision.",
        "Build a live product-research/opportunity data source so the dashboard's Opportunities panel reflects real candidates for a live organisation, not just demo data.",
        "Build a live stock-monitoring query so the dashboard's Stock panel reflects real supplier stock levels for a live organisation.",
    ])

    subsub("BLOCKED")
    bullets([
        "eBay Sandbox OAuth — refresh-token pairing fails with an eBay-side error across every internally-controllable variable already tested; open with eBay Developer Support as ticket #260827-000029.",
        "Amazon Ads live verification — needs real Amazon Ads credentials this environment does not have; when available, run the read-only verification harness first, never the write-verification path against a live-spending campaign.",
    ])

    subsub("REQUIRES EXTERNAL APPROVAL / ACTION")
    bullets([
        "A real production deployment — a live Supabase project, a chosen hosting provider, and the automation cron secret configured — is the one remaining step no amount of further code can substitute for.",
    ])

    subsub("IDEAS / FUTURE")
    bullets([
        "Amazon and eBay write connectors (publish/update listings), once read-side integrations are live-verified and the business is ready to expand beyond Shopify.",
        "Automated refund handling within a small, explicitly configured limit, if ever wanted — currently proposal-only in practice.",
    ])

    story.append(PageBreak())

    # ===========================================================================
    # PART 14 — GLOSSARY / DICTIONARY
    # ===========================================================================

    part("Part 14 — Glossary / Dictionary")
    body("Plain-English definitions for every technical and Commerce-OS-specific term used in this manual, in alphabetical order.")
    spacer(6)

    def gloss(term, definition):
        story.append(IndexMark(term))
        story.append(Paragraph(f"<b>{term}</b>", styles["GlossaryTerm"]))
        story.append(Paragraph(definition, styles["GlossaryDef"]))

    GLOSSARY = [
        ("Approval", "A pending, reviewable proposal for a real action (like a price change) that has not happened yet. Nothing changes until you approve or reject it. See Part 7."),
        ("Audit log / Audit entry", "A permanent, unchangeable record of a real action — who did it, what changed, and when. Commerce OS writes one for every state-changing action."),
        ("Automation level", "A setting controlling how much Commerce OS is allowed to do on its own before asking you, ranging from fully manual to bounded automatic action within limits you set. See Part 8."),
        ("Awaiting Purchase / AWAITING_SUPPLIER", "The stage a customer order sits in after it's placed but before you've bought the matching item from your supplier. See the Purchase Queue, Part 6."),
        ("Blocked (compliance)", "A compliance check has actively failed — this product/channel combination cannot proceed until it's resolved. See Part 3."),
        ("Business health", "The dashboard's nine-tile, Healthy/Watch/At risk/Critical summary across Financial, Product, Supplier, Marketplace, Fulfilment, Compliance, Advertising, Automation, and Data quality. See Part 10."),
        ("Capability descriptor", "A structural declaration of exactly what a marketplace connector (e.g. eBay's) is technically able to do — used so nothing can silently attempt an action it wasn't built for."),
        ("Channel", "A single marketplace Commerce OS can sell through — Shopify, Amazon UK, or eBay, in this version."),
        ("Channel decision", "The operator's Add/Block/Test/Watch/Hold/Remove/Review decision for one product on one specific channel — independent of that product's overall decision. See Part 3."),
        ("Client-credentials (OAuth)", "A machine-to-machine authentication method where the server itself, not a person, proves its identity to a marketplace's API using a stored key pair."),
        ("Commerce Intelligence (chat)", "Commerce OS's built-in AI assistant. Advisory only — it can explain, summarise, and draft proposals, but is structurally unable to execute a real action directly."),
        ("Compliance assessment", "A deterministic check of what's known about a product against marketplace/legal requirements, resulting in PASS / REVIEW REQUIRED / BLOCKED / NOT ASSESSED. See Part 3."),
        ("Connector", "The piece of code that talks to one specific external system (Shopify, Amazon, eBay, an advertising platform) on Commerce OS's behalf."),
        ("Deterministic", "Produces the same result every time from the same inputs, following fixed rules — as opposed to a judgement call or an AI-generated answer. Commerce OS's gates and recommendations are deterministic by design."),
        ("Fact-first architecture", "The core design principle of Commerce OS: real, verified facts (from the database) always take priority over any AI-generated statement, and the AI is never the source of truth for what's real."),
        ("Fulfilment", "Everything involved in getting a purchased product to the customer — packing, shipping, tracking, delivery."),
        ("Gate (publication gate)", "A named, ordered checklist Commerce OS runs before recommending a product be sold on a channel — every requirement must pass, or the outcome is blocked/pending. See Part 3."),
        ("Idempotency", "A safety property ensuring that accidentally repeating the same action (e.g. a network retry) cannot cause it to happen twice for real."),
        ("Known net margin / Known net profit", "Profit calculated only from the costs and fees Commerce OS actually has real data for — described as \"known\" rather than \"total\" because unmodelled costs (e.g. eBay fees today) are honestly excluded, not guessed."),
        ("Live verified", "The strongest status label used in this manual — means a capability has been tested successfully against a real, live account, not just built and unit-tested."),
        ("Marketplace", "A platform where products are actually sold to customers — Shopify, Amazon, and eBay in Commerce OS today."),
        ("Not assessed", "A compliance or readiness outcome meaning there wasn't enough information to reach a verdict — always treated as blocking, never silently treated as a pass. See Part 3."),
        ("OAuth", "An industry-standard way for one system to be granted limited, revocable access to another system's data without ever handling that system's password."),
        ("Opportunities (dashboard panel)", "A dashboard section intended to surface new product candidates — currently returns real results only in demo mode; empty for a live organisation until a live research source is connected. See Part 10."),
        ("Org / Organisation", "The account boundary in Commerce OS's database — a user belongs to one or more organisations, and Row Level Security ensures they only ever see their own organisation's data."),
        ("Owner (role)", "The highest-permission user role, able to approve proposed actions and change decisions."),
        ("Product decision", "The operator's overall Add/Block/Test/Watch/Hold/Remove/Review decision for a product, before any per-channel refinement. See Part 3."),
        ("Product lifecycle", "The full journey of a product through Commerce OS, from discovery to (potentially) removal. See Part 4."),
        ("Profitability gate", "The specific check within the publication gate confirming a product clears the configured minimum margin on a given channel, after real costs and fees."),
        ("Purchase Queue", "The screen where you record real supplier purchases, shipments, and deliveries against customer orders. See Parts 6 and 7."),
        ("Recommendation (SELL/WATCH/HOLD/REVIEW/REMOVE)", "Commerce OS's deterministic, advisory suggestion for what to do with a product on a channel — derived entirely from the publication gate's own results, never a second reasoning engine. See Part 3."),
        ("Refresh token", "A long-lived secret credential used to obtain fresh short-lived access to a marketplace's API without repeating a full login every time."),
        ("Requirement (gate requirement)", "One individually-checked condition inside the publication gate (e.g. \"profitability\", \"compliance\"), each independently satisfied or failed with its own plain-English reason."),
        ("Review required (compliance)", "A compliance outcome meaning something needs a human's judgement before proceeding — not a hard block, but not a pass either."),
        ("Row Level Security (RLS)", "A database-level rule (not just application code) ensuring a user can only ever access data belonging to their own organisation, enforced no matter how the request is made."),
        ("Sandbox", "A marketplace's test environment, separate from its real/production environment, used to test integrations safely without affecting real listings, orders, or money."),
        ("Server-only", "Code marked to run exclusively on Commerce OS's own servers, never sent to or executed in a user's browser — used for anything touching secrets or the database directly."),
        ("SKU", "Stock Keeping Unit — a unique code identifying one specific product/variant."),
        ("Stage (product stage)", "Where a product currently sits in its lifecycle (see Part 4) — e.g. draft, evaluated, ready, live."),
        ("Supplier", "The business Commerce OS's dropshipping model buys a product from, only once a customer has actually ordered it."),
        ("Supplier capability", "What a specific supplier is actually able to do — blind shipping, custom packaging, tracking, returns handling — checked against what a channel requires."),
        ("Verdict (compliance verdict)", "The single overall result of a compliance assessment — PASS, REVIEW REQUIRED, BLOCKED (fail), or NOT ASSESSED."),
    ]

    for term, definition in GLOSSARY:
        gloss(term, definition)

    story.append(PageBreak())

    # ===========================================================================
    # INDEX
    # ===========================================================================

    part("Index")
    body("Page numbers refer to where each term is first introduced or most substantively discussed.")
    spacer(6)


def build_index_flowables():
    by_term = {}
    for (_mark_id, term), page in INDEX_TERMS.items():
        by_term.setdefault(term, set()).add(page)
    entries = []
    for term in sorted(by_term.keys(), key=lambda t: t.lower()):
        pages = sorted(by_term[term])
        page_list = ", ".join(str(p) for p in pages)
        entries.append(Paragraph(f"{term} — {page_list}", styles["IndexEntry"]))
    return entries

# The Index's own entries are appended after a first build pass populates
# INDEX_TERMS with real page numbers (see the two-stage build at the bottom
# of this script) — nothing here fakes a page number.

# ---------------------------------------------------------------------------
# BUILD — two stages, so the Index page lists real, non-fake page numbers.
#
# Stage 1 renders the whole document once (throwaway output) purely so
# every IndexMark's afterFlowable callback fires and INDEX_TERMS is
# populated with each term's real, final page number. Stage 2 then calls
# populate_content() again — building entirely fresh flowable objects, not
# reusing stage 1's already-drawn ones, since reportlab flowables cache
# internal layout state that isn't safe to reuse across two separate
# doc/canvas builds — appends the actual index entries (built from that
# now-complete INDEX_TERMS), and renders the real, final output file. The
# genuine reportlab TableOfContents flowable (`toc`) is the one object
# deliberately reused unmodified across both stages; its own per-build
# reset (the same mechanism multiBuild's internal passes already rely on
# for TOC stabilisation) keeps its entries correct on stage 2 without
# manual bookkeeping.
# ---------------------------------------------------------------------------

populate_content()
_stage1_doc = make_doc(OUTPUT_PATH)
_stage1_doc.multiBuild(list(story))

# Everything before the Index section is byte-identical between stage 1
# and stage 2 (the index entries are only ever appended after it), so
# stage 1's now-stable page numbers are exactly what stage 2 will render
# at those same positions — captured here, before stage 2 builds fresh
# flowables (and starts overwriting INDEX_TERMS under new mark identities)
# and produces the real, final output file.
index_entries = build_index_flowables()

populate_content()
story.extend(index_entries)
_final_doc = make_doc(OUTPUT_PATH)
_final_doc.multiBuild(list(story))

print(f"Built {OUTPUT_PATH} — {len(index_entries)} index terms, generated {GENERATED_ON}")
