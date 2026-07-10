/**
 * Skeleton loader (per the /ui standard — never a bare spinner). A pulsing block
 * sized to match the real content it stands in for. Compose several to mirror a
 * layout (see SkeletonCards for the Overview grid).
 */
export function Skeleton({ className = "" }: { className?: string }) {
  // `@skeleton` = the catalog's pulsing block (animate-pulse rounded bg-muted).
  // Space on the non-recipe side: the expander rewrites recipe-bearing
  // literals and trims their edges, which would glue className onto the
  // expansion ("bg-mutedh-4 …").
  return <div aria-hidden="true" className={"@skeleton" + " " + className} />;
}

/** Bordered-list rows placeholder — audit feed, tokens, moderation queue. */
export function SkeletonRows({
  count = 4,
  label = "Loading",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className="overflow-hidden rounded-lg border border-border"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={
            "flex items-center gap-3 p-3" +
            (i > 0 ? " border-t border-border" : "")
          }
        >
          <Skeleton className="h-1.5 w-1.5 rounded-full" />
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="hidden h-3 w-44 sm:block" />
          <Skeleton className="ml-auto h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

/** Single summary/settings panel placeholder — billing card, domains card. */
export function SkeletonPanel({
  lines = 3,
  label = "Loading",
}: {
  lines?: number;
  label?: string;
}) {
  const widths = ["w-full", "w-5/6", "w-2/3", "w-3/4", "w-1/2"];
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className="@card space-y-3 p-5"
    >
      <Skeleton className="h-4 w-28" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={"h-3 " + widths[i % widths.length]} />
      ))}
      <Skeleton className="h-8 w-28" />
    </div>
  );
}

/**
 * Page-detail BODY placeholder — the hero/properties grid only. The detail
 * view renders its real back button and tabs while loading (/ui: static
 * chrome is known — mask only the data).
 */
export function SkeletonDetailBody() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      aria-busy="true"
      className="grid gap-4 lg:grid-cols-3"
    >
      <div className="@card flex flex-col p-5 lg:col-span-2">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="mt-3 h-8 w-14" />
        <Skeleton className="mt-2 h-3 w-40" />
        <div className="mt-6 space-y-2 border-t border-border pt-3">
          <Skeleton className="h-3 w-52" />
          <Skeleton className="h-3 w-60" />
        </div>
      </div>
      <div className="@card space-y-4 p-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
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
