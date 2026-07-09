import type { ReactNode } from "react";

/**
 * Consistent view header (#213) — a small term-green eyebrow, the section
 * title, and a one-line description, matching the typographic rhythm of the
 * cloud landing page and the Domains screen. `actions` slot sits on the right
 * (e.g. a count, a primary button). Keeps every dashboard view opening on the
 * same beat instead of each one starting flat.
 */
export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        {eyebrow ? (
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <span className="text-term" aria-hidden="true">
              ▚
            </span>
            {eyebrow}
          </div>
        ) : null}
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
