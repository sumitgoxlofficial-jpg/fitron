"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-error";
import { Button, LinkButton } from "@/components/ui";

/**
 * What a visitor sees when a page fails (src/app/error.tsx and src/app/(app)/error.tsx). The reference is the error's
 * digest: the same code is in the server log next to the failure, so a message to support that quotes it is enough to
 * find what happened.
 */
export function ErrorScreen({ error, retry, where, home }: { error: Error & { digest?: string }; retry: () => void; where: "page" | "app"; home: { href: string; label: string } }) {
  useEffect(() => reportClientError(error, where), [error, where]);
  return (
    <div role="alert" className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-16">
      <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">Something went wrong</p>
      <h1 className="text-3xl font-semibold sm:text-4xl">This page hit a problem on our side</h1>
      <p className="text-lg text-muted">Try again. If it keeps happening, tell us and quote the reference below, and we can find exactly what went wrong.</p>
      {error.digest ? (
        <p className="text-sm text-muted">
          Reference <code className="rounded border border-line bg-surface px-1.5 py-0.5 text-fg">{error.digest}</code>
        </p>
      ) : (
        // No digest: it failed in the browser, so there is no server log line to find. Its own message names what broke
        // (it is the browser's, not our data's), so show it for a screenshot to support.
        <p className="text-sm break-words text-muted">
          Details for support <code className="rounded border border-line bg-surface px-1.5 py-0.5 text-fg">{browserDetails(error)}</code>
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={() => retry()}>
          Try again
        </Button>
        <Button onClick={() => location.reload()}>Reload page</Button>
        <LinkButton href={home.href}>{home.label}</LinkButton>
        <LinkButton href="/contact?topic=support" variant="ghost">
          Contact support
        </LinkButton>
      </div>
    </div>
  );
}

/** What failed in the browser, short enough to read on a phone: "TypeError: Cannot read properties of undefined". */
export const browserDetails = (error: Error) => `${error.name || "Error"}: ${String(error.message || "no message")}`.slice(0, 200);
