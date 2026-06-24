import type { Lifecycle, Visibility } from "../lib/types";

/** Small neutral pill used across views. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "danger" | "accent";
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/40 text-destructive"
      : tone === "accent"
        ? "border-term/40 text-term"
        : "border-border text-muted-foreground";
  return (
    <span
      className={
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] " +
        toneClass
      }
    >
      {children}
    </span>
  );
}

/** Visibility pill: public (accent) / unlisted / private (neutral). */
export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  return (
    <Badge tone={visibility === "public" ? "accent" : "neutral"}>
      {visibility}
    </Badge>
  );
}

/** Lifecycle status dot + label — green for active, red for dead/quarantined. */
export function LifecycleStatus({ lifecycle }: { lifecycle: Lifecycle }) {
  const live = lifecycle === "active";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={
          "h-1.5 w-1.5 rounded-full " +
          (live ? "bg-term" : "bg-destructive")
        }
      />
      {live ? "live" : lifecycle}
    </span>
  );
}
