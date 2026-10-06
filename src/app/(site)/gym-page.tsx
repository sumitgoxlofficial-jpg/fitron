import { GUIDES, guidePath } from "@/lib/domain/guides";
import { GYM_ACCOUNTING, GYM_PAGES, planNote, type GymPage } from "@/lib/domain/gym-pages";
import { PLANS, TRIAL_DAYS, rupeesLabel } from "@/lib/domain/pricing";
import { gymSignupHref } from "@/lib/domain/site-links";
import { absoluteUrl, breadcrumbJsonLd, faqJsonLd, jsonLdScript, pageMetadata, SITE_NAME } from "@/lib/seo";
import { LiveDemo } from "./live-demo";

// One of the public pages about Gym Accounting (content in src/lib/domain/gym-pages.ts). Plain <a> links, like the rest of
// the public pages: the home page they point to is a static file, not a route.

const btn = "inline-flex items-center justify-center rounded-md px-5 py-3 text-sm leading-[1.2] font-semibold transition-colors";
const primary = `${btn} border border-transparent bg-accent text-accent-ink hover:bg-accent-hover`;
const secondary = `${btn} border border-line text-fg hover:bg-fg/7`;

export const gymPageMetadata = (p: GymPage) => pageMetadata({ title: p.title, description: p.description, path: p.path });

const gymPlans = PLANS.filter((p) => p.product === "GYM_ACCOUNTING");

export function GymPageView({ page }: { page: GymPage }) {
  const others = GYM_PAGES.filter((p) => p.path !== page.path);
  const graph: object[] = [
    breadcrumbJsonLd([
      ["FITRON", "/"],
      [page.label, page.path],
    ]),
    faqJsonLd(page.faq),
  ];
  if (page.path === GYM_ACCOUNTING.path) {
    graph.push({
      "@type": "SoftwareApplication",
      "@id": absoluteUrl(`${GYM_ACCOUNTING.path}#software`),
      name: "FITRON Gym Accounting",
      url: absoluteUrl(page.path),
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: page.description,
      publisher: { "@id": absoluteUrl("/#org") },
      offers: gymPlans.map((p) => ({
        "@type": "Offer",
        name: p.name,
        price: p.price.MONTHLY / 100,
        priceCurrency: "INR",
        priceSpecification: { "@type": "UnitPriceSpecification", price: p.price.MONTHLY / 100, priceCurrency: "INR", billingDuration: 1, unitCode: "MON", valueAddedTaxIncluded: true },
      })),
    });
  }

  return (
    <article className="mx-auto max-w-3xl">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <a href="/" className="hover:text-fg">
              {SITE_NAME}
            </a>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{page.label}</li>
        </ol>
      </nav>

      <header className="mt-6">
        <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">{page.kicker}</p>
        <h1 className="mt-3 text-4xl leading-tight font-semibold sm:text-5xl">{page.h1}</h1>
        <p className="mt-5 text-lg text-muted">{page.intro}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <a href={gymSignupHref({ plan: "professional" })} className={primary}>
            Start your {TRIAL_DAYS}-day free trial
          </a>
          <a href="/#pricing" className={secondary}>
            See pricing
          </a>
        </div>
        <p className="mt-3 text-sm text-muted">No card needed. Or ask us for a demo on WhatsApp +91 62077 74673.</p>
        {page.path === GYM_ACCOUNTING.path && (
          <figure className="mt-10 overflow-hidden rounded-lg border border-line">
            <LiveDemo
              poster="/site/console-dashboard.webp"
              width={1400}
              height={658}
              alt="FITRON Gym Accounting dashboard showing active members, revenue, outstanding dues and renewals for a gym"
            />
            <figcaption className="px-4 py-2 text-sm text-muted">The Gym Accounting dashboard: members, revenue, dues and renewals at a glance. Try the live demo to click around it.</figcaption>
          </figure>
        )}
      </header>

      <div className="mt-12 flex flex-col gap-10 leading-relaxed">
        {page.blocks.map((b) => (
          <section key={b.id} id={b.id} className="scroll-mt-6">
            <h2 className="text-2xl font-semibold">{b.heading}</h2>
            {b.feature && <p className="mt-2 inline-block rounded-full border border-line px-3 py-0.5 text-xs font-semibold text-muted">{planNote(b.feature)}</p>}
            <p className="mt-3 text-muted">{b.body}</p>
            {b.points && (
              <ul className="mt-3 list-disc pl-6 text-muted">
                {b.points.map((x) => (
                  <li key={x} className="mt-1.5">
                    {x}
                  </li>
                ))}
              </ul>
            )}
            {b.link && (
              <p className="mt-3">
                <a href={b.link[1]} className="font-semibold text-accent underline">
                  {b.link[0]}
                </a>
              </p>
            )}
          </section>
        ))}

        <section id="plans" className="scroll-mt-6">
          <h2 className="text-2xl font-semibold">Plans and pricing</h2>
          <p className="mt-3 text-muted">Every plan starts with a {TRIAL_DAYS}-day free trial. Prices are per month, GST included; yearly plans are billed upfront.</p>
          <ul className="mt-5 grid gap-4 sm:grid-cols-3">
            {gymPlans.map((p) => (
              <li key={p.key} className="rounded-lg border border-line p-4">
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-1 text-2xl font-semibold">
                  {rupeesLabel(p.price.MONTHLY)}
                  <span className="text-sm font-normal text-muted"> / month</span>
                </p>
                <p className="mt-2 text-sm text-muted">{p.card?.limit}</p>
                <p className="mt-1 text-sm text-muted">{p.card?.audience}</p>
              </li>
            ))}
          </ul>
          <p className="mt-4">
            <a href="/#pricing" className="font-semibold text-accent underline">
              Compare everything each plan includes
            </a>
          </p>
        </section>

        <section id="faq" className="scroll-mt-6">
          <h2 className="text-2xl font-semibold">Questions</h2>
          <div className="mt-4 flex flex-col divide-y divide-line border-y border-line">
            {page.faq.map((f) => (
              <details key={f.q} className="py-3">
                <summary className="cursor-pointer font-semibold">{f.q}</summary>
                <p className="mt-2 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="more" className="scroll-mt-6">
          <h2 className="text-2xl font-semibold">Keep reading</h2>
          <ul className="mt-3 list-disc pl-6">
            {others.map((p) => (
              <li key={p.path} className="mt-1.5">
                <a href={p.path} className="font-semibold text-accent underline">
                  {p.label}
                </a>
              </li>
            ))}
            {GUIDES.map((g) => (
              <li key={g.slug} className="mt-1.5">
                <a href={guidePath(g)} className="font-semibold text-accent underline">
                  Guide: {g.label}
                </a>
              </li>
            ))}
            <li className="mt-1.5">
              <a href="/#together" className="font-semibold text-accent underline">
                The FITRON AI Trainer, for your members
              </a>
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-line p-6">
          <h2 className="text-2xl font-semibold">Try it with your own gym&apos;s numbers</h2>
          <p className="mt-2 text-muted">Open an account, add a few members and make one invoice. If it is not for you, nothing is charged: the trial needs no card, and a paid plan starts only when you choose it.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href={gymSignupHref({ plan: "professional" })} className={primary}>
              Start your {TRIAL_DAYS}-day free trial
            </a>
            <a href="/contact?topic=demo" className={secondary}>
              Ask for a demo
            </a>
          </div>
        </section>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />
    </article>
  );
}
