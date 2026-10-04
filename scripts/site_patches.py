#!/usr/bin/env python3
"""Edits to the home page (public/site/index.html) that are not in the design export.

scripts/import-site.py rebuilds the page from the design export, so every edit we make on top of it
lives here and is applied by the importer after it has rewired the buttons. Run on its own to patch
the page in place:

    python3 scripts/site_patches.py

Every patch is idempotent: running it on a page that already has it changes nothing, and a patch that
no longer applies (the design changed the text it looks for) stops with a message instead of being skipped.
"""
import html as htmllib
import json
import os
import re
import sys

PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "site", "index.html")


def swap(page, old, new, why):
    """Replace `old` with `new` once. `new` must not contain `old`, so a patched page is recognised."""
    assert old not in new, why
    if old in page:
        assert page.count(old) == 1, f"{why}: expected one match, found {page.count(old)}"
        return page.replace(old, new)
    assert new in page, f"{why}: neither the original text nor the patched text is on the page"
    return page


def add(page, anchor, addition, marker, why, before=False):
    """Insert `addition` next to the first `anchor`, unless `marker` shows it is already there."""
    if marker in page:
        return page
    assert anchor in page, f"{why}: anchor not found"
    return page.replace(anchor, addition + anchor if before else anchor + addition, 1)


# What Gym Accounting really exports is Excel and CSV (reports, ledgers, member and payment lists).
# It has no Tally import file, so the page must not promise one.
TEXT = [
    ("GST-ready · Tally export", "GST-ready · Excel export", "hero chip"),
    ("Numbered invoices, month exported to Tally for your accountant", "Numbered invoices, month exported to Excel for your accountant", "stats band"),
    ("Tally export, month lock, audit log", "Excel and CSV export, month lock, audit log", "Gym Accounting card"),
    ("Does Gym Accounting work with Tally and GST?", "Does Gym Accounting handle GST and my accountant's books?", "FAQ question"),
    ("as a Tally file or Excel for your accountant.", "as Excel or CSV files for your accountant.", "FAQ answer"),
    # The number of sections in the sidebar (src/lib/nav.ts); site-links.test.ts keeps them equal.
    ('<span class="num-3d gold-3d">22</span><p>Gym modules', '<span class="num-3d gold-3d">24</span><p>Gym modules', "module count"),
    (
        "never shown to the gym. <a href=\"/privacy\">Read the policies.</a>",
        "never shown to the gym. The AI replies are written by an AI provider that may process them outside India: the privacy policy says what is sent. <a href=\"/privacy\">Read the policies.</a>",
        "FAQ: data",
    ),
]

# On a phone the cookie banner and the WhatsApp button float above the open menu and cover its lower links.
MENU_CSS = "/*fitron:menu-over-banner*/body.menu-open .consent,body.menu-open .wa-float{opacity:0;visibility:hidden;pointer-events:none}"

# The design's own phone rule `.hero{grid-template-columns:1fr}` is overridden by two later, unscoped
# `.hero{grid-template-columns:1.1fr .9fr}` rules, so on phones the hero stayed a two-column grid with an empty
# first column: the headline started 43 px in and ran 38 px past the right edge (and the 3D logo had no room).
# Selectors start with `body` so they win whatever their order. The floating cards are tucked inside the screen.
HERO_CSS = (
    "/*fitron:hero-phone*/@media (max-width:900px){"
    "body .hero{grid-template-columns:minmax(0,1fr)}body .hero-copy{min-width:0}body .hero .badge{white-space:normal}"
    "body .hero .hero-points{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:14px}}"
    "@media (max-width:520px){body .float-card.fc-1{left:0}body .float-card.fc-2{right:0}}"
)

# The 3D logo is decoration. Its 1.2 MB library is not downloaded for visitors who asked for less motion or
# less data, and for everyone else it loads once the page has loaded and the browser is idle, so it no longer
# competes with the first paint.
BOOT_OLD = "import('/site/fitron-3d.js').then((m) => m.start(document.getElementById('scene'))).catch((e) => console.warn('[FITRON] 3D logo unavailable, showing the flat logo', e));"
BOOT_NEW = """const lite = matchMedia('(prefers-reduced-motion: reduce)').matches || (navigator.connection && navigator.connection.saveData);
const load3d = () => import('/site/fitron-3d.js').then((m) => m.start(document.getElementById('scene'))).catch((err) => console.warn('[FITRON] 3D logo unavailable, showing the flat logo', err));
const later = () => ('requestIdleCallback' in window ? requestIdleCallback(load3d, { timeout: 3000 }) : setTimeout(load3d, 500));
if (!lite) { if (document.readyState === 'complete') later(); else addEventListener('load', later); }"""

ALT = "FITRON AI Trainer app on a phone: day streak, weekly goal, today's workout and today's meals"

# Prices are checked against src/lib/domain/pricing.ts by site-links.test.ts.
OFFERS = {
    "FITRON AI Trainer": [("AI Pro", 299), ("AI Premium", 499)],
    "FITRON Gym Accounting": [("Starter", 999), ("Professional", 1999), ("Enterprise", 3999)],
}


def faq(page):
    """(question, answer) for every item of the page's own FAQ, as plain text."""
    block = page[page.index('id="faq"'):]
    out = []
    for q, a in re.findall(r"<details><summary>(.*?)</summary><p>(.*?)</p></details>", block, re.S):
        text = lambda h: re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", h))).strip()
        out.append((text(q), text(a)))
    return out


def structured_data(page):
    org = {"@id": "https://fitron.in/#org"}
    apps = []
    for name, offers in OFFERS.items():
        ai = name.endswith("AI Trainer")
        apps.append({
            "@type": "SoftwareApplication",
            "name": name,
            "applicationCategory": "HealthApplication" if ai else "BusinessApplication",
            "operatingSystem": "Web",
            "publisher": org,
            "offers": [
                {"@type": "Offer", "name": n, "price": p, "priceCurrency": "INR",
                 "priceSpecification": {"@type": "UnitPriceSpecification", "price": p, "priceCurrency": "INR", "billingDuration": 1, "unitCode": "MON", "valueAddedTaxIncluded": False}}
                for n, p in offers
            ],
        })
    graph = [
        {"@type": "Organization", "@id": "https://fitron.in/#org", "name": "FITRON", "url": "https://fitron.in/", "logo": "https://fitron.in/fitron-logo.png",
         "email": "hello@fitron.in", "telephone": "+91 62077 74673", "areaServed": "IN",
         "contactPoint": {"@type": "ContactPoint", "contactType": "customer support", "email": "hello@fitron.in", "telephone": "+91 62077 74673", "areaServed": "IN", "availableLanguage": "en"}},
        *apps,
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq(page)]},
    ]
    body = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False).replace("</", "<\\/")
    return f'<script type="application/ld+json">{body}</script>\n'


def apply(page):
    for old, new, why in TEXT:
        page = swap(page, old, new, why)
    # Real alt text on the AI Trainer screenshot (the file may be .png or .webp).
    page, n = re.subn(r'(<img data-gallery-img="" src="[^"]+") alt="[^"]*"', lambda m: f'{m.group(1)} alt="{ALT}"', page)
    assert n == 1 and f'alt="{ALT}"' in page, "AI Trainer screenshot not found"
    page = add(page, "</style>", MENU_CSS, "fitron:menu-over-banner", "menu over banner", before=True)
    page = add(page, "</style>", HERO_CSS, "fitron:hero-phone", "hero on phones", before=True)
    page = swap(page, BOOT_OLD, BOOT_NEW, "3D logo loading")
    page = add(page, '<li><a href="/contact">Contact us</a></li>', '\n      <li><a href="/contact#company">Company details</a></li>', "/contact#company", "footer company link")
    # Rebuilt each time, so a changed FAQ or price list reaches the structured data.
    page = re.sub(r'<script type="application/ld\+json">.*?</script>\n', "", page, flags=re.S)
    page = add(page, "</head>", structured_data(page), "@@never@@", "structured data", before=True)
    return page


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else PAGE
    before = open(path, encoding="utf-8").read()
    after = apply(before)
    if after == before:
        print("Already up to date:", os.path.normpath(path))
    else:
        open(path, "w", encoding="utf-8").write(after)
        print("Patched", os.path.normpath(path))
