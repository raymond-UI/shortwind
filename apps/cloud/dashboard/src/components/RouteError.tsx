import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

/**
 * Themed error + not-found boundaries (wired as the router's
 * `defaultErrorComponent` / `defaultNotFoundComponent`). Replaces TanStack's
 * raw "Something went wrong! / Hide Error" default — which leaked Convex
 * "[Request ID …] Server Error" strings full-bleed — with a centered card on
 * the shared theme, a friendly message, and recovery actions.
 */

/** Pull a human message off a thrown value; Convex puts it on `error.data`. */
function friendlyMessage(error: unknown): string {
  const data = (error as { data?: unknown } | null | undefined)?.data;
  if (data && typeof data === "object") {
    const d = data as { message?: unknown };
    if (typeof d.message === "string" && d.message.length > 0) return d.message;
  }
  return "Something went wrong while loading this view. This is usually temporary.";
}

/** Raw detail for the collapsible debug panel (never shown by default). */
function rawDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "Unknown error";
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-16 text-foreground">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      await router.invalidate();
      reset();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Shell>
      <div className="@card p-6 text-center">
        <div
          className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive"
          aria-hidden="true"
        >
          !
        </div>
        <h1 className="mt-4 text-base font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {friendlyMessage(error)}
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="sw-btn-primary rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {retrying ? "Retrying…" : "Try again"}
          </button>
          <Link
            to="/dashboard/$section"
            params={{ section: "overview" }}
            className="rounded-md border border-border px-4 py-2 text-sm transition-colors hover:bg-secondary"
          >
            Back to dashboard
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-4 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {open ? "Hide details" : "Show details"}
        </button>
        {open ? (
          <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-border bg-background p-3 text-left text-[11px] leading-relaxed text-muted-foreground">
            {rawDetail(error)}
          </pre>
        ) : null}
      </div>
    </Shell>
  );
}

export function RouteNotFound() {
  return (
    <Shell>
      <div className="@card p-6 text-center">
        <div
          className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-border bg-secondary text-muted-foreground"
          aria-hidden="true"
        >
          ∅
        </div>
        <h1 className="mt-4 text-base font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          That page doesn’t exist or may have moved.
        </p>
        <div className="mt-5">
          <Link
            to="/dashboard/$section"
            params={{ section: "overview" }}
            className="sw-btn-primary rounded-md px-4 py-2 text-sm font-semibold"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </Shell>
  );
}
