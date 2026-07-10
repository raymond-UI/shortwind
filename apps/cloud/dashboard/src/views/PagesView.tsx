import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { relativeTime } from "../lib/format";
import { pageHost, pageUrl } from "../lib/urls";
import { Badge, LifecycleStatus, VisibilityBadge } from "../components/Badge";
import { CopyValue } from "../components/CopyValue";
import { Dialog } from "../components/Dialog";
import { EmptyState } from "../components/EmptyState";
import { Menu, MenuItem } from "../components/Menu";
import { SectionHeader } from "../components/SectionHeader";
import { SkeletonCards } from "../components/Skeleton";
import type { PageWithVersions } from "../lib/types";

/**
 * Overview (epic #184, console redesign) — the owner's hosted pages as a
 * Vercel-style console: search + sort + New Page controls, a status filter that
 * defaults to Live so tombstoned/quarantined pages don't crowd the grid (they
 * sit behind an archive ghost card instead), and identity-avatar cards. All
 * styling is Shortwind `@recipe` shorthand + theme tokens. `onOpen` drills into
 * detail; the Visit link opens the live page without triggering the drill-in.
 */
type StatusFilter = "live" | "archived" | "all";
type SortKey = "activity" | "name";

const STATUS_LABEL: Record<StatusFilter, string> = {
  live: "Live",
  archived: "Archived",
  all: "All",
};

const SORT_LABEL: Record<SortKey, string> = {
  activity: "Last published",
  name: "Name A–Z",
};

export function PagesView({ onOpen }: { onOpen?: (id: string) => void }) {
  const { pages } = useDashboardData();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("live");
  const [sort, setSort] = useState<SortKey>("activity");
  const [newPageOpen, setNewPageOpen] = useState(false);

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

  const liveCount = pages.filter((p) => p.page.lifecycle === "active").length;
  const archivedCount = pages.length - liveCount;

  const q = query.trim().toLowerCase();
  const shown = pages
    .filter((p) =>
      status === "all"
        ? true
        : status === "live"
          ? p.page.lifecycle === "active"
          : p.page.lifecycle !== "active",
    )
    .filter(
      (p) =>
        q === "" ||
        p.page.slug.toLowerCase().includes(q) ||
        p.page.tags.some((t) => t.toLowerCase().includes(q)),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.page.slug.localeCompare(b.page.slug)
        : b.page.updatedAt - a.page.updatedAt,
    );

  return (
    <div className="space-y-5">
      <SectionHeader eyebrow="Pages" title="Your hosted pages" />

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search pages"
          placeholder="Search pages…"
          data-testid="pages-search"
          className="@input sm:flex-1"
        />
        <Menu
          align="end"
          label="Sort pages"
          trigger={
            <span className="@button-secondary-sm whitespace-nowrap">
              Sort: {SORT_LABEL[sort]} ▾
            </span>
          }
        >
          {(close) => (
            <>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                <MenuItem
                  key={key}
                  testId={`sort-${key}`}
                  active={sort === key}
                  onSelect={() => {
                    setSort(key);
                    close();
                  }}
                >
                  {SORT_LABEL[key]}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
        <button
          type="button"
          onClick={() => setNewPageOpen(true)}
          className="@button-primary-sm whitespace-nowrap"
        >
          ＋ New Page
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center overflow-hidden rounded-full border border-border">
          <Menu
            label="Filter pages by status"
            trigger={
              <span className="px-2.5 py-1 transition-colors hover:text-foreground">
                Status: {STATUS_LABEL[status]} ▾
              </span>
            }
          >
            {(close) => (
              <>
                {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((key) => (
                  <MenuItem
                    key={key}
                    testId={`status-${key}`}
                    active={status === key}
                    onSelect={() => {
                      setStatus(key);
                      close();
                    }}
                  >
                    {STATUS_LABEL[key]}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
          {status !== "all" ? (
            <button
              type="button"
              aria-label="Clear status filter"
              onClick={() => setStatus("all")}
              className="border-l border-border px-2 py-1 transition-colors hover:bg-secondary hover:text-foreground"
            >
              ✕
            </button>
          ) : null}
        </span>
        <span data-testid="pages-count" className="tabular-nums">
          {shown.length} of {pages.length} pages
        </span>
      </div>

      {shown.length === 0 ? (
        <p
          data-testid="pages-no-match"
          className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
        >
          No pages match{q ? <> “{query.trim()}”</> : null} — try a different
          search or status.
        </p>
      ) : (
        <ul
          data-testid="pages-view"
          className="@grid-3 grid list-none gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {shown.map((p) => (
            <li key={p.page.id}>
              <PageCard entry={p} onOpen={onOpen} />
            </li>
          ))}
          {status === "live" && archivedCount > 0 ? (
            <li>
              <button
                type="button"
                data-testid="pages-archive-ghost"
                onClick={() => setStatus("archived")}
                className="flex h-full min-h-28 w-full items-center justify-center rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
              >
                View {archivedCount} archived{" "}
                {archivedCount === 1 ? "page" : "pages"} →
              </button>
            </li>
          ) : null}
        </ul>
      )}

      <Dialog
        open={newPageOpen}
        onClose={() => setNewPageOpen(false)}
        labelledBy="new-page-title"
      >
        <div className="space-y-3">
          <h3 id="new-page-title" className="text-sm font-semibold">
            Publish a new page
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Pages ship from the CLI — run this next to your HTML file and it
            appears here the moment the deploy lands.
          </p>
          <div className="rounded-md border border-border bg-secondary/50 px-2 py-1.5">
            <CopyValue value="shortwind deploy ./index.html" />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setNewPageOpen(false)}
              className="@button-secondary-sm"
            >
              Done
            </button>
          </div>
        </div>
      </Dialog>
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
  const host = pageHost(page.slug);
  const interactive = Boolean(onOpen);
  const live = page.lifecycle === "active";
  const visibleTags = page.tags.slice(0, 2);
  const extraTags = page.tags.length - visibleTags.length;

  // Accessible clickable card: the title is a real <button> whose hit area is
  // stretched over the whole card (`after:absolute after:inset-0`); the Visit
  // link sits above it (`relative z-10`). Real focusable controls + no nested
  // interactives (button and link are siblings) — unlike a `div role="button"`.
  //
  // Hierarchy rule: the card states only EXCEPTIONS. Live (the default under
  // the Live filter) is just a dot; unlisted (the default visibility) shows no
  // badge. Version + age live in a separated quiet footer, not a sentence.
  return (
    <article
      data-testid={`page-card-${page.slug}`}
      className={
        (interactive ? "@card-interactive" : "@card") +
        " relative flex h-full flex-col p-5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
      }
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-secondary text-xs font-semibold uppercase text-term"
        >
          {page.slug[0]}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-6 tracking-tight">
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
          <a
            href={pageUrl(page.slug)}
            target="_blank"
            rel="noreferrer"
            className="@link relative z-10 block truncate text-xs text-muted-foreground/80 hover:text-term"
            title={host}
          >
            {host} ↗
          </a>
        </div>
        {live ? (
          <span className="mt-1.5 flex shrink-0" title="live">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-term"
            />
            <span className="sr-only">live</span>
          </span>
        ) : (
          <LifecycleStatus lifecycle={page.lifecycle} />
        )}
      </div>

      <div className="relative z-10 mt-6 flex items-center gap-1.5 border-t border-border pt-3">
        {page.visibility !== "unlisted" ? (
          <VisibilityBadge visibility={page.visibility} />
        ) : null}
        {visibleTags.map((t) => (
          <Badge key={t}>{t}</Badge>
        ))}
        {extraTags > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            +{extraTags}
          </span>
        ) : null}
        <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground tabular-nums">
          v{page.currentVersion} · {relativeTime(page.updatedAt)}
        </span>
      </div>
    </article>
  );
}
