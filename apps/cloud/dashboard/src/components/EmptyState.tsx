import type { ReactNode } from "react";

/**
 * Shared empty / placeholder state — a bordered card with a glyph, title, and
 * supporting copy. Used for "nothing here yet" and for not-yet-wired surfaces
 * (e.g. Analytics, which has a designed empty state until edge telemetry lands).
 */
export function EmptyState({
  icon,
  title,
  description,
  children,
  testId,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/30 px-6 py-16 text-center"
    >
      {icon ? (
        <div className="mb-3 text-2xl text-muted-foreground" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
