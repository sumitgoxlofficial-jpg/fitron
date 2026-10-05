import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: send visitors without a session cookie to sign-in.
// Real checks happen on the server in every page and action.
export function proxy(req: NextRequest) {
  // The home page is the public marketing site.
  if (req.nextUrl.pathname === "/") return NextResponse.next();
  if (!req.cookies.has("fitron_session")) {
    // Come back to the page they wanted after logging in.
    const login = new URL("/login", req.url);
    login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  // The website is public: /site (static home page files), sign-in chooser, sign-up, email links, contact, policies, the Gym Accounting pages (src/lib/domain/gym-pages.ts), robots and sitemap.
  // Webhooks, the job runner and door devices (/iclock) authenticate with their own signatures and secrets.
  matcher: ["/((?!auth/|login|signin|signup|verify-email|forgot-password|reset-password|contact|privacy|terms|refund|gym-accounting|gym-management-software|gym-gst-billing|robots.txt|sitemap.xml|site/|_next/|favicon.ico|fitron-mark.png|fitron-logo.png|api/health|api/client-error|api/webhooks/|api/jobs/|iclock/|trainer|api/trainer/|api/coach).*)"],
};
