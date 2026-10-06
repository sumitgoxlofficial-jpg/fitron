# Performance

## How it was measured

Lighthouse 12, headless Chromium, against `next start` of a production build on the same machine (so no network, and the
numbers describe the page and its files, not a host). Mobile is Lighthouse's default: a slow-4G connection and a CPU 4× slower,
all *simulated*. Desktop uses its desktop preset.

```bash
npm run build && npx next start -p 3300 &
npx lighthouse@12 http://localhost:3300/gym-accounting --only-categories=performance,accessibility,best-practices,seo \
  --chrome-flags="--headless=new --no-sandbox"                 # add --preset=desktop for desktop
```

## Result (October 2026)

Lighthouse is a lab test. The real numbers are the field data in Search Console's Core Web Vitals report after launch. The
lab's total blocking time (TBT) stands in for INP, which needs a person using the page.

| Page | Mobile perf | Mobile LCP (lab) | Desktop perf | Accessibility / Best practices / SEO |
| --- | --- | --- | --- | --- |
| `/` | 97 | 2.5 s | 100 | 100 / 100 / 100 |
| `/gym-accounting` | 93 | 3.2 s | 100 | 100 / 100 / 100 |
| `/gym-gst-billing` | 96 | 2.6 s | 100 | 100 / 100 / 100 |
| `/ai-personal-trainer` | 99 | 2.1 s | 100 | 100 / 100 / 100 |
| `/contact` | 99 | 2.1 s | 100 | 100 / 100 / 100 |
| `/tools`, `/tools/<name>` | 96 to 99 | 2.2 to 2.7 s | 100 | 100 / 100 / 100 |
| `/privacy`, `/terms`, `/guides` | 98 to 99 | 2.0 to 2.1 s | 100 | 100 / 100 / 100 |

Every page: layout shift (CLS) 0 to 0.04 (target under 0.1), total blocking time 0 to 80 ms (INP target under 200 ms).
Desktop LCP is 0.6 to 0.7 s. `/signin` scores 66 on SEO because it is deliberately `noindex`.

Mobile LCP in the lab is above the 2.5 s target on `/gym-accounting` and a few others. The lab's slow-4G simulation counts every
byte on the page against the first paint; in the same run the *unthrottled* LCP of these pages is about a second or less. Watch the field
numbers before spending more on it.

## What was done

- The home page's biggest picture is requested at the top of the page, with a smaller file for small screens (`srcset`).
- Pictures below the first screen are lazy; the design had marked two eager and high-priority.
- The 3D logo library (260 KB) loads only when the closing section is near, and not at all where WebGL cannot run.
- Public pages preload the two fonts they use and no longer preload the console's serif font.
- The cookie banner on the public pages waits 2.5 s so it is not the largest thing painted.
- The logo's picture keeps its aspect ratio, and only the logo at the top of a page is high-priority.

## If a score drops

Run the command above on the page that changed. The usual causes: a new picture larger than the slot it fills, a picture
above the fold that is not preloaded, a script added to every page, or a font weight added to `site.css`.
