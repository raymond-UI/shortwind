import { useDashboardData } from "../lib/data";
import { relativeTime } from "../lib/format";
import { pageHost, pageUrl } from "../lib/urls";
import { Badge, LifecycleStatus, VisibilityBadge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { SkeletonCards } from "../components/Skeleton";
import type { PageWithVersions } from "../lib/types";

/**
 * Overview (epic #184) — the owner's hosted pages as a card grid, authored in
 * Shortwind `@recipe` shorthand (`@card-interactive`, `@stack-sm`, `@row-between`,
 * text recipes) dogfooded through the build. Each card surfaces the live URL,
 * visibility, lifecycle, version, and last-deploy. `onOpen` drills into detail;
 * the Visit link opens the live page without triggering the drill-in.
 */
export function PagesView({ onOpen }: { onOpen?: (id: string) => void }) {
  const { pages } = useDashboardData();

  if (pages === undefined) {
    return <SkeletonCards />;
  }
  if (pages.length === 0) {
    return (
      <EmptyState
        icon="◳"
        title="No pages published yet"
        description={
          <>
            Publish your first page with{" "}
            <code className="@code-inline">shortwind deploy &lt;file&gt;</code>.
          </>
        }
        testId="pages-empty"
      />
    );
  }

  return (
    <div
      data-testid="pages-view"
      className="@grid-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {pages.map((p) => (
        <PageCard key={p.page.id} entry={p} onOpen={onOpen} />
      ))}
    </div>
  );
}

function PageCard({
  entry,
  onOpen,
}: {
  entry: PageWithVersions;
  onOpen?: (id: string) => void;
}) {
  const { page } = entry;
  const host = pageHost(page.slug, page.customDomain);
  const interactive = Boolean(onOpen);

  return (
    <div
      data-testid={`page-card-${page.slug}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onOpen?.(page.id) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onOpen?.(page.id);
            }
          : undefined
      }
      // @card-interactive = the catalog's clickable card (hover shadow + focus
      // ring); @stack-sm stacks the inner rows.
      className={interactive ? "@card-interactive @stack-sm" : "@card @stack-sm"}
    >
      <div className="@row-between flex items-start gap-2">
        <span className="truncate font-medium" title={page.slug}>
          {page.slug}
        </span>
        <LifecycleStatus lifecycle={page.lifecycle} />
      </div>

      <a
        href={pageUrl(page.slug, page.customDomain)}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="@link truncate text-xs text-muted-foreground hover:text-term"
        title={host}
      >
        {host} ↗
      </a>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <VisibilityBadge visibility={page.visibility} />
        <Badge>v{page.currentVersion}</Badge>
        {page.tags.map((t) => (
          <Badge key={t}>{t}</Badge>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {relativeTime(page.updatedAt)}
        </span>
      </div>
    </div>
  );
}
