import type { ReactNode } from "react";

/**
 * Shared empty / placeholder state — the catalog's `@empty` recipes
 * (`@empty` / `@empty-icon` / `@empty-title` / `@empty-description`). Used for
 * "nothing here yet" and for not-yet-wired surfaces.
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
    <div data-testid={testId} className="@empty">
      {icon ? (
        <div className="@empty-icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h3 className="@empty-title">{title}</h3>
      {description ? <p className="@empty-description">{description}</p> : null}
      {children ? <div>{children}</div> : null}
    </div>
  );
}
