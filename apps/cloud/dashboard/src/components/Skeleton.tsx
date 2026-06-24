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
        <div key={i} className="@card flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="h-3 w-40" />
          <div className="mt-auto flex gap-2 pt-1">
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-5 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}
