import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findGuide, GUIDES, guidePath } from "@/lib/domain/guides";
import { pageMetadata } from "@/lib/seo";
import { GuideView } from "../../guide-view";

// One guide for gym owners (content in src/lib/domain/guides.ts). Only the guides in that file exist: any other address
// is a 404 from notFound() below. Not `dynamicParams = false`: the console's revalidatePath("/", "layout") marks these
// prerendered pages stale, and with dynamicParams off Next.js then answered every guide with a 404 (NoFallbackError).

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps<"/guides/[slug]">): Promise<Metadata> {
  const g = findGuide((await params).slug);
  if (!g) return {};
  const m = pageMetadata({ title: g.title, description: g.description, path: guidePath(g) });
  return { ...m, openGraph: { ...m.openGraph, type: "article", publishedTime: g.published } };
}

export default async function Page({ params }: PageProps<"/guides/[slug]">) {
  const g = findGuide((await params).slug);
  if (!g) notFound();
  return <GuideView guide={g} />;
}
