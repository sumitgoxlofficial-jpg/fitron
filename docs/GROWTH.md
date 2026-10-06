# Growing fitron.in: content, links and trust

What follows is the plan for the work that code cannot do, written to fit what the site is today. `deploy/SEO.md` lists what
is built in and the one-off setup steps (Search Console, Bing); `docs/ANALYTICS.md` lists the tracked events.

The rules for everything below: no bought links, no link networks, no automated spam, no fake profiles, reviews, ratings,
testimonials or statistics. Every claim on a page must be one the product can back (`npm test` checks the main ones).

## Content (on-site)

The architecture already exists: `/guides` and `/guides/[slug]`, written in `src/lib/domain/guides.ts` and listed in the
sitemap. Keep using it rather than adding a second `/blog`: two sections for the same kind of article split links and
confuse readers. If you ever want a news-style blog, give it its own path then.

Write each article for one search, with a named author, a "last updated" date, and a link to the product page it belongs to.
Three clusters, each with a pillar page and supporting guides:

| Pillar | Supporting guides |
| --- | --- |
| Gym management software | gym membership software; gym billing; gym fee management; gym attendance; gym expense tracking; gym P&L; gym GST billing; gym payroll |
| Gym business | how to calculate gym profit; reduce member churn; manage expenses; manage several branches; automate payment reminders; move from Excel to gym software |
| AI personal trainer | what is an AI personal trainer; AI vs human trainer; how AI workout plans work; a beginner workout plan; Indian meal planning; tracking protein; staying consistent |

Location pages (Delhi, Mumbai, Bengaluru, Ranchi, Jamshedpur, Chandigarh…) only if each has something true and local to say,
such as how the city's gyms bill or which GST questions come up. Never a template with the city name swapped.

## Linkable assets (build once, earn links over time)

Small free tools people share: gym profit calculator, membership revenue calculator, break-even calculator, GST on gym
memberships calculator, member churn calculator, protein and calorie calculators. Each is a page under `/tools/…` with its
method written out and a link to the matching product page. None exists yet.

## Off-page

- **Gym-software side:** gym-industry publications and owner communities, SaaS and business-software directories (list the
  product with its real prices and screenshots), Indian startup media, accounting and finance sites. Offer them original
  material: a guide, a calculator, or numbers from your own product, not a press release.
- **Fitness side:** fitness blogs, trainers' sites, wellness and fitness-technology publications, Indian fitness communities.
  Offer expert commentary or a guest article on training and food for Indian lifestyles, reviewed by a qualified person.
- **Partner gyms:** ask each partner gym to link to its FITRON page. A real customer linking to you is the best link there is.
- **Digital PR:** one honest announcement per real milestone, tailored to each outlet. Never the same release everywhere.
- **Founder:** the founder's own writing, talks and interviews on building FITRON, Indian fitness technology and gym business.
  This needs the founder's own words and name; it cannot be written for them.
- Do not chase domain rating. A relevant link from a small gym blog beats a generic one from a large site.

## Trust (E-E-A-T): what is missing and needs you

The site has real pricing, real screenshots, policies, a grievance officer and contact details. It does **not** yet have:

1. **An About page** with who runs FITRON, the company name and the founder. Only you can supply this; it was left out rather
   than invented. Add it as `/about`, link it from the footer's Company column and add it to the sitemap.
2. **Real customer stories.** Ask a few gyms for a quote and permission, then publish them with their name.
3. **Real author names and dates** on every guide.
4. **Official social accounts** for the footer and the Organization schema's `sameAs`. None are linked because none are
   known. Add them only when they exist.

Do not add review or rating markup until real reviews exist on a third-party site.

## Known gaps in this redesign

- **Unknown addresses do not show the 404 page to signed-out visitors.** `src/proxy.ts` sends every path that is not on the
  public list to sign-in (default-deny, on purpose), so `fitron.in/anything-wrong` answers 307 to `/login` instead of 404, for
  search engines too. Fixing it means deciding which paths are the console's and letting the rest 404; that is a security
  decision, so it was not changed here.
- **The sign-in page is a chooser, not a form.** Gym owners and members have separate sign-in systems (`/login` and `/trainer`),
  so `/signin` sends people to the right one instead of asking for a password itself.
- **Per-feature screenshots** for each Gym Accounting feature are not on the page: the repository holds one real dashboard
  screenshot and one real app screenshot, and a made-up screen would break the rule above. Capture real ones and add them.
- **Lighthouse and Core Web Vitals** were not measured here (no field data or lab run). The home page's heaviest assets are the
  two WebP screenshots; the 3D logo library (1.2 MB) loads only when idle and is now visible only near the closing section.
  Measure after deploy with PageSpeed Insights and Search Console's Core Web Vitals report.
