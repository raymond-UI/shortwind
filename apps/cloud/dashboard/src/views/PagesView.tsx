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
    <ul
      data-testid="pages-view"
      className="@grid-3 grid list-none gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {pages.map((p) => (
        <li key={p.page.id}>
          <PageCard entry={p} onOpen={onOpen} />
        </li>
      ))}
    </ul>
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

  // Accessible clickable card: the title is a real <button> whose hit area is
  // stretched over the whole card (`after:absolute after:inset-0`); the Visit
  // link sits above it (`relative z-10`). Real focusable controls + no nested
  // interactives (button and link are siblings) — unlike a `div role="button"`.
  return (
    <article
      data-testid={`page-card-${page.slug}`}
      className={
        (interactive ? "@card-interactive" : "@card") +
        " @stack-sm relative focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
      }
    >
      <div className="@row-between flex items-start gap-2">
        <h3 className="truncate font-medium">
          {interactive ? (
            <button
              type="button"
              onClick={() => onOpen?.(page.id)}
              title={page.slug}
              className="after:absolute after:inset-0 after:rounded-lg focus:outline-none"
            >
              {page.slug}
            </button>
          ) : (
            <span title={page.slug}>{page.slug}</span>
          )}
        </h3>
        <LifecycleStatus lifecycle={page.lifecycle} />
      </div>

      <a
        href={pageUrl(page.slug, page.customDomain)}
        target="_blank"
        rel="noreferrer"
        className="@link relative z-10 truncate text-xs text-muted-foreground hover:text-term"
        title={host}
      >
        {host} ↗
      </a>

      <div className="relative z-10 mt-auto flex flex-wrap items-center gap-2 pt-1">
        <VisibilityBadge visibility={page.visibility} />
        <Badge>v{page.currentVersion}</Badge>
        {page.tags.map((t) => (
          <Badge key={t}>{t}</Badge>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {relativeTime(page.updatedAt)}
        </span>
      </div>
    </article>
  );
}
