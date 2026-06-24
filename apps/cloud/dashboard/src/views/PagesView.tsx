import { useDashboardData } from "../lib/data";
import { relativeTime } from "../lib/format";
import { pageHost, pageUrl } from "../lib/urls";
import { Badge, LifecycleStatus, VisibilityBadge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import type { PageWithVersions } from "../lib/types";

/**
 * Overview (epic #184, issue #2) — the owner's hosted pages as a card grid
 * (Vercel/Cloudflare Pages style). Each card surfaces the live URL, visibility,
 * lifecycle status, current version, and last-deploy time. `onOpen` (wired by
 * the shell) drills into the project detail; the "Visit" link opens the live
 * page without triggering the drill-in.
 */
export function PagesView({ onOpen }: { onOpen?: (id: string) => void }) {
  const { pages } = useDashboardData();

  if (pages === undefined) {
    return <div className="text-sm text-muted-foreground">Loading pages…</div>;
  }
  if (pages.length === 0) {
    return (
      <EmptyState
        icon="◳"
        title="No pages published yet"
        description={
          <>
            Publish your first page with{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              shortwind deploy &lt;file&gt;
            </code>
            .
          </>
        }
        testId="pages-empty"
      />
    );
  }

  return (
    <div
      data-testid="pages-view"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
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
      className={
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors " +
        (interactive
          ? "cursor-pointer hover:border-foreground/25 focus:border-foreground/25 focus:outline-none"
          : "")
      }
    >
      <div className="flex items-start justify-between gap-2">
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
        className="truncate text-xs text-muted-foreground hover:text-term"
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
