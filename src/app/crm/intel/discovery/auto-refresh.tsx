"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the page's data every few seconds while a job is queued or running, so progress shows without reloading. */
export function AutoRefresh({ active, seconds = 8 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [active, seconds, router]);
  return null;
}
