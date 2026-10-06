import { Logo } from "@/components/logo";

// Public pages of fitron.in that sit next to the static home page.
// The home page is a static file, so links to it are plain <a>, not <Link>.

// The pages about each product, linked from every public page so search engines and visitors can reach them.
const products = [
  ["/ai-personal-trainer", "AI personal trainer"],
  ["/gym-accounting", "Gym accounting software"],
  ["/gym-management-software", "Gym management software"],
  ["/gym-gst-billing", "GST invoices for gyms"],
] as const;

const legal = [
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms & Conditions"],
  ["/refund", "Refund Policy"],
  ["/privacy#cookies", "Cookie Policy"],
  ["/privacy#grievance", "Grievance Officer"],
  ["/contact", "Contact us"],
  ["/contact#company", "Company details"],
] as const;

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(ellipse_at_top_left,var(--accent-soft),transparent_55%)]">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-5">
        <a href="/" aria-label="FITRON home">
          <Logo size={36} />
        </a>
        <nav className="flex items-center gap-5 text-sm font-semibold">
          <a href="/ai-personal-trainer" className="hidden text-muted hover:text-fg sm:inline">
            AI Trainer
          </a>
          <a href="/gym-accounting" className="hidden text-muted hover:text-fg sm:inline">
            Gym Accounting
          </a>
          <a href="/#pricing" className="text-muted hover:text-fg">
            Pricing
          </a>
          <a href="/signin" className="text-muted hover:text-fg">
            Sign in
          </a>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-16">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 text-sm text-muted lg:flex-row lg:items-center lg:justify-between">
          <p>© 2026 FITRON · hello@fitron.in · WhatsApp +91 62077 74673</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {products.map(([href, label]) => (
              <li key={href}>
                <a href={href} className="hover:text-fg">
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {legal.map(([href, label]) => (
              <li key={href}>
                <a href={href} className="hover:text-fg">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  );
}
