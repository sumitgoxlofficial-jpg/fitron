import { LinkButton } from "@/components/ui";

// An address that doesn't exist on fitron.in (and what notFound() shows outside the console).
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 px-4 py-24">
      <p className="text-xs font-semibold tracking-[0.2em] text-accent uppercase">Page not found</p>
      <h1 className="text-3xl font-semibold sm:text-4xl">We couldn&apos;t find that page</h1>
      <p className="text-lg text-muted">The address may have changed, or it was typed wrong.</p>
      <div className="flex flex-wrap gap-3">
        <LinkButton href="/" variant="primary">
          Back to fitron.in
        </LinkButton>
        <LinkButton href="/signin">Sign in</LinkButton>
      </div>
    </div>
  );
}
