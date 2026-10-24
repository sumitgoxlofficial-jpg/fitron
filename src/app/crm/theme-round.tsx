"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { flipTheme } from "@/components/theme-toggle";

/** The round light/dark button from the design. */
export function ThemeToggleRound() {
  return (
    <button type="button" onClick={flipTheme} title="Switch between light and dark theme" aria-label="Switch between light and dark theme" className="grid size-11 shrink-0 place-items-center rounded-full border border-[var(--line-2)] hover:border-[var(--accent)]">
      <SunIcon size={18} weight="duotone" className="light:hidden" />
      <MoonIcon size={18} weight="duotone" className="hidden light:block" />
    </button>
  );
}
