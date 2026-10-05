import type { MetadataRoute } from "next";
import { GYM_PAGES } from "@/lib/domain/gym-pages";

export default function robots(): MetadataRoute.Robots {
  return {
    // Only the public website is indexed; the console and APIs are private.
    rules: { userAgent: "*", allow: ["/", ...GYM_PAGES.map((p) => p.path), "/contact", "/privacy", "/terms", "/refund"], disallow: ["/api/", "/login", "/signin", "/signup", "/dashboard", "/c/"] },
    sitemap: "https://fitron.in/sitemap.xml",
  };
}
