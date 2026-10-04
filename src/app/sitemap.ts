import type { MetadataRoute } from "next";

const base = "https://fitron.in";

// No lastModified: it was a date typed in by hand, and a wrong date is worse than none. /signup is left out
// because each of its plans now opens its own product's sign-in (/login or /trainer).
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/refund`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
