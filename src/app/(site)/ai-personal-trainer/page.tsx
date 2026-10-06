import Link from "next/link";
import { GYM_PAGES } from "@/lib/domain/gym-pages";
import { rupeesLabel, TRIAL_DAYS } from "@/lib/domain/pricing";
import { trainerHref } from "@/lib/domain/site-links";
import { TRAINER_PAGE as page, TRAINER_PLAN_LIST } from "@/lib/domain/trainer-page";
import { absoluteUrl, breadcrumbJsonLd, faqJsonLd, jsonLdScript, pageMetadata, SITE_NAME } from "@/lib/seo";

// The public page about the FITRON AI Trainer (content in src/lib/domain/trainer-page.ts). It looks like the pages about
// Gym Accounting (../gym-page.tsx), with the trainer's own plans and a link into the member app.

const primary = "s-btn s-btn-primary";
const secondary = "s-btn s-btn-ghost";

export const metadata = pageMetadata({ title: page.title, description: page.description, path: page.path });

export default function Page() {
  const graph: object[] = [
    breadcrumbJsonLd([
      ["FITRON", "/"],
      [page.label, page.path],
    ]),
    faqJsonLd(page.faq),
    {
      "@type": "SoftwareApplication",
      "@id": absoluteUrl(`${page.path}#software`),
      name: "FITRON AI Trainer",
      url: absoluteUrl(page.path),
      applicationCategory: "HealthApplication",
      operatingSystem: "Web",
      description: page.description,
      publisher: { "@id": absoluteUrl("/#org") },
      offers: TRAINER_PLAN_LIST.map((p) => ({
        "@type": "Offer",
        name: p.name,
        price: p.price.MONTHLY / 100,
        priceCurrency: "INR",
        priceSpecification: { "@type": "UnitPriceSpecification", price: p.price.MONTHLY / 100, priceCurrency: "INR", billingDuration: 1, unitCode: "MON", valueAddedTaxIncluded: true },
      })),
    },
  ];

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
          <a href={trainerHref("ai-pro")} className={primary} data-track="start_ai_trial" data-track-from="ai-trainer-page">
            Start your {TRIAL_DAYS}-day free trial
          </a>
          <a href="/#pricing" className={secondary}>
            See pricing
          </a>
        </div>
        <p className="mt-3 text-sm text-muted">No card needed. Cancel any time.</p>
      </header>

      <div className="mt-12 flex flex-col gap-10 leading-relaxed">
        {page.blocks.map((b) => (
          <section key={b.id} id={b.id} className="scroll-mt-28">
            <h2 className="text-2xl font-semibold">{b.heading}</h2>
            <p className="mt-3 text-muted">{b.body}</p>
            {"points" in b && b.points && (
              <ul className="mt-3 list-disc pl-6 text-muted">
                {b.points.map((x) => (
                  <li key={x} className="mt-1.5">
                    {x}
                  </li>
                ))}
              </ul>
            )}
            {"link" in b && b.link && (
              <p className="mt-3">
                <a href={b.link[1]} className="font-semibold text-accent underline">
                  {b.link[0]}
                </a>
              </p>
            )}
          </section>
        ))}

        <section id="plans" className="scroll-mt-28">
          <h2 className="text-2xl font-semibold">Plans and pricing</h2>
          <p className="mt-3 text-muted">Both plans start with a {TRIAL_DAYS}-day free trial. Prices include GST; yearly plans are billed upfront.</p>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {TRAINER_PLAN_LIST.map((p) => (
              <li key={p.key} className="rounded-lg border border-line p-4">
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-1 text-2xl font-semibold">
                  {rupeesLabel(p.price.MONTHLY)}
                  <span className="text-sm font-normal text-muted"> / month</span>
                </p>
                <p className="mt-2 text-sm text-muted">or {rupeesLabel(p.price.YEARLY)} a year</p>
                <p className="mt-1 text-sm text-muted">{p.tagline}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="faq" className="scroll-mt-28">
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

        <section id="tools" className="scroll-mt-28">
          <h2 className="text-2xl font-semibold">Free calculators</h2>
          <p className="mt-3 text-muted">
            Not ready to start? Work out your daily protein with the{" "}
            <Link href="/tools/protein-calculator" className="font-semibold text-accent underline">
              protein calculator
            </Link>{" "}
            or your calories with the{" "}
            <Link href="/tools/calorie-calculator" className="font-semibold text-accent underline">
              calorie calculator
            </Link>
            . Both are free and need no sign-up.
          </p>
        </section>

        <section id="more" className="scroll-mt-28">
          <h2 className="text-2xl font-semibold">Run a gym?</h2>
          <p className="mt-3 text-muted">
            Give the AI Trainer to your members and earn 70% of every eligible subscription, subject to the partnership terms.{" "}
            <a href="/#partnership" className="font-semibold text-accent underline">
              See the gym partnership
            </a>{" "}
            or{" "}
            <a href="/#pricing" className="font-semibold text-accent underline">
              compare all plans
            </a>
            .
          </p>
          <ul className="mt-3 list-disc pl-6">
            {GYM_PAGES.map((p) => (
              <li key={p.path} className="mt-1.5">
                <a href={p.path} className="font-semibold text-accent underline">
                  {p.label}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="s-card p-6">
          <h2 className="text-2xl font-semibold">Start your {TRIAL_DAYS}-day free trial.</h2>
          <p className="mt-2 text-muted">Tell FITRON your goal and the equipment you have, and your plan is built around it. The trial needs no card, and a paid plan starts only when you choose it.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href={trainerHref("ai-pro")} className={primary} data-track="start_ai_trial" data-track-from="ai-trainer-page">
              Start your {TRIAL_DAYS}-day free trial
            </a>
          </div>
        </section>
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />
    </article>
  );
}
