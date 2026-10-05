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
    # Only invoices come out as PDF, so the Professional card no longer promises "PDF financial exports": what it adds
    # is Excel and CSV exports of the accounting reports and ledgers (the Accounting section is Professional).
    ("Excel and PDF financial exports", "Excel and CSV accounting exports", "Professional card: exports"),
    # AI Pro and AI Premium. The app gives every member the same features (workouts, food plan, habits, progress,
    # reminders, weekly review) and differs by tier in one thing only: AI Coach messages per day, 25 or 100
    # (COACH_DAILY_LIMIT in src/lib/domain/trainer.ts; landing-page.test.ts keeps the numbers equal). The page
    # used to list six Premium-only features that every member already has, and called the limit monthly.
    ("<span>Basic progress tracking</span>", "<span>Progress tracking and a weekly review</span>", "AI Pro: progress"),
    ("<span>AI fitness chat, with monthly usage limits</span>", "<span>AI Coach: 25 messages a day</span>", "AI Pro: chat limit"),
    ('<p class="pc-who">Advanced AI coaching and long-term progress tracking.</p>', '<p class="pc-who">Everything in AI Pro, with a higher daily AI Coach limit.</p>', "AI Premium: tagline"),
    # The number of sections in the sidebar (src/lib/nav.ts); site-links.test.ts keeps them equal.
    ('<span class="num-3d gold-3d">22</span><p>Gym modules', '<span class="num-3d gold-3d">24</span><p>Gym modules', "module count"),
    # The same count appears twice more; landing-page.test.ts checks every "N modules" on the page against the sidebar.
    ("</svg>22 modules: members, billing, GST, expenses, P&amp;L", "</svg>24 modules: members, billing, GST, expenses, P&amp;L", "Gym Accounting card: module count"),
    ("Gym Accounting, all 22 modules", "Gym Accounting, all 24 modules", "partner perks: module count"),
    # What search results show: the page leads with what people search for. Kept under about 60 and 160 characters
    # (landing-page.test.ts). The visible headline is the design's and is left alone.
    (
        "<title>FITRON — Your AI personal trainer, and your gym's accounts</title>",
        "<title>Gym Accounting Software &amp; AI Personal Trainer | FITRON</title>",
        "page title",
    ),
    (
        '<meta name="description" content="FITRON: an AI personal trainer for ₹299 a month, and gym accounting software with GST invoices, WhatsApp reminders and P&amp;L from ₹999 a month.">',
        '<meta name="description" content="Gym accounting software with GST invoices, fees, WhatsApp reminders and P&amp;L from ₹999 a month, plus an AI personal trainer for ₹299 a month. 7-day free trial.">',
        "meta description",
    ),
    (
        '<meta property="og:title" content="FITRON: your AI trainer, and your gym\'s accounts">',
        '<meta property="og:title" content="FITRON: gym accounting software and an AI personal trainer">',
        "link preview title",
    ),
    # Links to the pages about Gym Accounting (src/lib/domain/gym-pages.ts): the product card, the footer and two FAQ answers.
    (
        '<a class="btn btn-gold" href="/signup?plan=professional">Start free trial <svg class="icon"><use href="#i-arrow"></use></svg></a><a class="btn btn-ghost" href="#products">Full details</a>',
        '<a class="btn btn-gold" href="/signup?plan=professional">Start free trial <svg class="icon"><use href="#i-arrow"></use></svg></a><a class="btn btn-ghost" href="/gym-accounting">Full details</a>',
        "Gym Accounting card: full details",
    ),
    (
        '<li><a href="#products">Gym Accounting</a></li><li><a href="#together">Better together</a></li>',
        '<li><a href="/gym-accounting">Gym Accounting</a></li><li><a href="/gym-management-software">Gym management software</a></li><li><a href="/gym-gst-billing">GST invoices for gyms</a></li><li><a href="#together">Better together</a></li>',
        "footer links to the Gym Accounting pages",
    ),
    (
        "as Excel or CSV files for your accountant.</p></details>",
        'as Excel or CSV files for your accountant. <a href="/gym-gst-billing">How GST billing works.</a></p></details>',
        "FAQ: GST link",
    ),
    ('<a href="#faq">More on gym accounting.</a>', '<a href="/gym-accounting">More on gym accounting.</a>', "FAQ: branches link"),
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

# The pricing tab bar (AI Trainer | Gym Accounting | Gym Partnership) has labels that cannot wrap and was a fixed 359 px
# wide, so below about 360 px it ran off both sides of the screen (the first tab was cut off at 320 px) and at 375 px its
# border sat a few pixels past the edge. Fluid type and padding keep it inside the screen at every phone width.
TABS_CSS = (
    "/*fitron:tabs-phone*/@media (max-width:420px){body .seg.p-tabs{max-width:100%}"
    "body .seg.p-tabs label>span{font-size:clamp(.72rem,3.4vw,.82rem);padding-left:clamp(5px,2vw,13px);padding-right:clamp(5px,2vw,13px)}}"
)

# The floating WhatsApp link sat outside every landmark, which screen-reader users meet as stray content (axe "region").
WA_OPEN = '<aside aria-label="Quick contact">'

# Keyboard and screen-reader use of the phone menu. fitron-page.js opens it by toggling body.menu-open and closes it on
# Escape, but focus stayed on the button and Tab walked through the page hidden behind the menu. This watches the same
# class: when the menu opens, focus moves to its first link and the page behind (main, footer, the WhatsApp button) is
# made inert; when it closes the page is live again and focus goes back to the menu button, unless a link in the menu
# was chosen (then the browser has already moved focus to where that link leads).
MENU_JS = """<script>/*fitron:menu-a11y*/
(function () {
  var btn = document.querySelector('.menu-btn'), menu = document.getElementById('mobileMenu');
  if (!btn || !menu || !window.MutationObserver) return;
  var behind = [].slice.call(document.querySelectorAll('main, footer, .wa-float')), was = false, picked = false;
  menu.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a')) picked = true; });
  new MutationObserver(function () {
    var open = document.body.classList.contains('menu-open');
    if (open === was) return;
    was = open;
    behind.forEach(function (el) { if (open) el.setAttribute('inert', ''); else el.removeAttribute('inert'); });
    if (open) { var first = menu.querySelector('a'); if (first) first.focus({ preventScroll: true }); }
    else { var a = document.activeElement; if (!picked && (a === document.body || menu.contains(a))) btn.focus({ preventScroll: true }); }
    picked = false;
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();
</script>
"""

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
            # The Gym Accounting entity is described in full on its own page (src/app/(site)/gym-page.tsx).
            **({} if ai else {"@id": "https://fitron.in/gym-accounting#software", "url": "https://fitron.in/gym-accounting"}),
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
        {"@type": "WebSite", "@id": "https://fitron.in/#website", "url": "https://fitron.in/", "name": "FITRON", "inLanguage": "en-IN", "publisher": org},
        {"@type": "Organization", "@id": "https://fitron.in/#org", "name": "FITRON", "url": "https://fitron.in/", "logo": "https://fitron.in/fitron-logo.png",
         "email": "hello@fitron.in", "telephone": "+91 62077 74673", "areaServed": "IN",
         "contactPoint": {"@type": "ContactPoint", "contactType": "customer support", "email": "hello@fitron.in", "telephone": "+91 62077 74673", "areaServed": "IN", "availableLanguage": "en"}},
        *apps,
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq(page)]},
    ]
    body = json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False).replace("</", "<\\/")
    return f'<script type="application/ld+json">{body}</script>\n'


CHECK_ITEM = '<li><svg class="icon"><use href="#i-check"></use></svg><span>{}</span></li>'
PREMIUM_LIST = re.compile(r'(<li class="pc-inc">Everything in AI Pro, plus</li>)(?:<li><svg class="icon"><use href="#i-check"></use></svg><span>[^<]*</span></li>)+(</ul>)')


def apply(page):
    for old, new, why in TEXT:
        page = swap(page, old, new, why)
    # Premium lists only what the app really gates by tier. Applying this again gives the same list.
    page, n = PREMIUM_LIST.subn(lambda m: m.group(1) + CHECK_ITEM.format("AI Coach: 100 messages a day") + m.group(2), page)
    assert n == 1, "AI Premium list not found"
    # Real alt text on the AI Trainer screenshot (the file may be .png or .webp).
    page, n = re.subn(r'(<img data-gallery-img="" src="[^"]+") alt="[^"]*"', lambda m: f'{m.group(1)} alt="{ALT}"', page)
    assert n == 1 and f'alt="{ALT}"' in page, "AI Trainer screenshot not found"
    page = add(page, "</style>", MENU_CSS, "fitron:menu-over-banner", "menu over banner", before=True)
    page = add(page, "</style>", HERO_CSS, "fitron:hero-phone", "hero on phones", before=True)
    page = add(page, "</style>", TABS_CSS, "fitron:tabs-phone", "pricing tabs on phones", before=True)
    # Wrap the WhatsApp link in a landmark (once).
    if WA_OPEN + '<a class="wa-float"' not in page:
        page, n = re.subn(r'(<a class="wa-float"[\s\S]*?</a>)', lambda m: WA_OPEN + m.group(1) + "</aside>", page, count=1)
        assert n == 1, "WhatsApp link not found"
    page = add(page, "</body>", MENU_JS, "fitron:menu-a11y", "menu keyboard focus", before=True)
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
