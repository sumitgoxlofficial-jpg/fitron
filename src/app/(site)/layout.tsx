import { SiteAnalytics, SiteConsent } from "./site-consent";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import "./site.css";

// Public pages of fitron.in that sit next to the static home page (which has its own copy of the header and footer).
// The home page is a static file, so links to it are plain <a>, not <Link>.

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-ui flex min-h-screen flex-col bg-[radial-gradient(ellipse_at_top_left,var(--accent-soft),transparent_55%)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-accent-ink">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-20 sm:pt-12">
        {children}
      </main>
      <SiteFooter />
      <SiteConsent />
      <SiteAnalytics />
    </div>
  );
}
