import type { Lifecycle, Visibility } from "../lib/types";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info";

/**
 * Small pill — the Shortwind `@badge` recipe, tone-driven by `data-tone` (the
 * catalog's tone system) so the class stays static and expands at build. No
 * data-tone = the neutral muted look.
 */
export function Badge({
  children,
  tone,
  outline = false,
}: {
  children: React.ReactNode;
  tone?: Tone;
  outline?: boolean;
}) {
  return (
    <span
      className={outline ? "@badge-outline" : "@badge"}
      {...(tone ? { "data-tone": tone } : {})}
    >
      {children}
    </span>
  );
}

/** Visibility pill: public reads as a positive tone; others stay neutral. */
export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  return (
    <Badge tone={visibility === "public" ? "success" : undefined}>
      {visibility}
    </Badge>
  );
}

/** Lifecycle status dot + label — term-green for live, destructive for dead. */
export function LifecycleStatus({ lifecycle }: { lifecycle: Lifecycle }) {
  const live = lifecycle === "active";
  return (
    <span className="@row inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={
          "h-1.5 w-1.5 rounded-full " + (live ? "bg-term" : "bg-destructive")
        }
      />
      {live ? "live" : lifecycle}
    </span>
  );
}
