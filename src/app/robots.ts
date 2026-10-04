import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    // Only the public website is indexed; the console and APIs are private.
    rules: { userAgent: "*", allow: ["/", "/signup", "/contact", "/privacy", "/terms", "/refund"], disallow: ["/api/", "/login", "/signin", "/dashboard"] },
    sitemap: "https://fitron.in/sitemap.xml",
  };
}
