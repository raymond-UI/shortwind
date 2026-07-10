/**
 * Skeleton loader (per the /ui standard — never a bare spinner). A pulsing block
 * sized to match the real content it stands in for. Compose several to mirror a
 * layout (see SkeletonCards for the Overview grid).
 */
export function Skeleton({ className = "" }: { className?: string }) {
  // `@skeleton` = the catalog's pulsing block (animate-pulse rounded bg-muted).
  return <div aria-hidden="true" className={"@skeleton " + className} />;
}

/** A grid of card-shaped skeletons matching the Overview page-card layout. */
export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div
      data-testid="pages-loading"
      role="status"
      aria-label="Loading pages"
      aria-busy="true"
      className="@grid-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="@card flex flex-col p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-2 w-2 rounded-full" />
          </div>
          <div className="mt-6 flex items-center justify-between border-t border-border pt-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}
