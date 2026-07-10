import { useDashboardData } from "../lib/data";
import { relativeTime } from "../lib/format";
import { SectionHeader } from "../components/SectionHeader";
import { Skeleton } from "../components/Skeleton";
import type { AuditRow, PageWithVersions } from "../lib/types";

/**
 * Analytics (console redesign) — built from the account data that actually
 * exists instead of a full-pane "coming soon": publish activity per day from
 * the audit feed, the lifecycle breakdown of pages, and the recently updated
 * list. Request/bandwidth telemetry stays a compact placeholder card until
 * edge collection lands.
 *
 * Chart method (dataviz): single series = one hue + no legend (the title
 * names it); bars are thin, baseline-anchored, 2px-gapped, rounded data-ends,
 * with a per-bar hover tooltip; values and labels wear text tokens, never the
 * series color. Lifecycle is a status palette: dot + label + count, never
 * color alone.
 */
const DAYS = 14;
const DAY_MS = 24 * 3600e3;

type DayBucket = { label: string; count: number };

function publishBuckets(auditLog: AuditRow[], now: number): DayBucket[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const first = today.getTime() - (DAYS - 1) * DAY_MS;
  const counts = new Array<number>(DAYS).fill(0);
  for (const e of auditLog) {
    if (e.action !== "page.publish") continue;
    const idx = Math.floor((e.createdAt - first) / DAY_MS);
    if (idx >= 0 && idx < DAYS) counts[idx] += 1;
  }
  return counts.map((count, i) => ({
    label: new Date(first + i * DAY_MS).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    count,
  }));
}

export function AnalyticsView({
  onOpenPage,
}: {
  onOpenPage?: (id: string) => void;
}) {
  const { auditLog, pages } = useDashboardData();
  const loading = auditLog === undefined || pages === undefined;

  const buckets = publishBuckets(auditLog ?? [], Date.now());
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const max = Math.max(1, ...buckets.map((b) => b.count));

  const live = (pages ?? []).filter((p) => p.page.lifecycle === "active");
  const tombstoned = (pages ?? []).filter(
    (p) => p.page.lifecycle === "tombstoned",
  );
  const quarantined = (pages ?? []).filter(
    (p) => p.page.lifecycle === "quarantined",
  );
  const recent = (pages ?? [])
    .slice()
    .sort((a, b) => b.page.updatedAt - a.page.updatedAt)
    .slice(0, 5);

  return (
    <div className="space-y-4" data-testid="analytics-view">
      <SectionHeader eyebrow="Analytics" title="Activity" />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Publish activity — single-series daily bars. */}
        <section className="@card flex flex-col p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <span className="@stat-label">Publish activity</span>
            <span className="text-xs text-muted-foreground">last 14 days</span>
          </div>
          {loading ? (
            <div
              role="status"
              aria-label="Loading analytics"
              aria-busy="true"
              className="mt-3 space-y-3"
            >
              <Skeleton className="h-8 w-14" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : (
            <>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="@stat-value" data-testid="publish-total">
                  {total}
                </span>
                <span className="text-xs text-muted-foreground">
                  {total === 1 ? "publish" : "publishes"}
                </span>
              </div>
              <div
                className="mt-4 flex h-28 items-end gap-0.5"
                role="img"
                aria-label={`Publishes per day over the last ${DAYS} days, ${total} total`}
              >
                {buckets.map((b, i) => (
                  <div
                    key={i}
                    className="group relative flex h-full flex-1 flex-col justify-end"
                  >
                    <div className="pointer-events-none absolute -top-7 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      {b.label} · {b.count}
                    </div>
                    {b.count > 0 ? (
                      <div
                        className="w-full rounded-t-[4px] bg-term/70 transition-colors group-hover:bg-term"
                        style={{ height: `${(b.count / max) * 100}%` }}
                      />
                    ) : (
                      <div className="h-0.5 w-full bg-border" />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                <span>{buckets[0].label}</span>
                <span>{buckets[buckets.length - 1].label}</span>
              </div>
            </>
          )}
        </section>

        {/* Lifecycle breakdown — status palette, dot + label + count. */}
        <section className="@card flex flex-col p-5">
          <span className="@stat-label">Pages by lifecycle</span>
          {loading ? (
            <div aria-hidden="true" className="mt-4 space-y-3">
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-28" />
            </div>
          ) : (
            <>
              <div
                className="mt-4 flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
                aria-hidden="true"
              >
                {live.length > 0 ? (
                  <div
                    className="rounded-full bg-term"
                    style={{ flexGrow: live.length }}
                  />
                ) : null}
                {tombstoned.length > 0 ? (
                  <div
                    className="rounded-full bg-muted-foreground/40"
                    style={{ flexGrow: tombstoned.length }}
                  />
                ) : null}
                {quarantined.length > 0 ? (
                  <div
                    className="rounded-full bg-destructive/80"
                    style={{ flexGrow: quarantined.length }}
                  />
                ) : null}
                {(pages ?? []).length === 0 ? (
                  <div className="w-full rounded-full bg-border" />
                ) : null}
              </div>
              <div className="mt-4 space-y-2 text-xs">
                <LifecycleRow
                  testId="lifecycle-live"
                  dotClass="bg-term"
                  label="live"
                  count={live.length}
                />
                {tombstoned.length > 0 ? (
                  <LifecycleRow
                    testId="lifecycle-tombstoned"
                    dotClass="bg-muted-foreground/40"
                    label="tombstoned"
                    count={tombstoned.length}
                  />
                ) : null}
                {quarantined.length > 0 ? (
                  <LifecycleRow
                    testId="lifecycle-quarantined"
                    dotClass="bg-destructive/80"
                    label="quarantined"
                    count={quarantined.length}
                  />
                ) : null}
              </div>
            </>
          )}
        </section>

        {/* Recently updated — a list, not a chart. */}
        <section className="@card flex flex-col p-5 lg:col-span-2">
          <span className="@stat-label">Recently updated</span>
          {loading ? (
            <div aria-hidden="true" className="mt-4 space-y-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-52" />
              <Skeleton className="h-4 w-36" />
            </div>
          ) : recent.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">No pages yet.</p>
          ) : (
            <ul className="mt-2 list-none">
              {recent.map((p) => (
                <RecentRow key={p.page.id} entry={p} onOpenPage={onOpenPage} />
              ))}
            </ul>
          )}
        </section>

        {/* Traffic — honest compact placeholder until edge telemetry lands. */}
        <section
          className="@card flex flex-col p-5"
          data-testid="analytics-traffic"
        >
          <div className="flex items-center justify-between">
            <span className="@stat-label">Traffic</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
              <span
                className="h-1.5 w-1.5 rounded-full bg-term"
                aria-hidden="true"
              />
              Coming soon
            </span>
          </div>
          <div
            className="mt-4 flex h-16 items-end gap-1 opacity-30"
            aria-hidden="true"
          >
            {[30, 52, 41, 68, 47, 80, 62, 74].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-[4px] bg-term/60"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Requests and bandwidth per page, collected at the edge.
          </p>
        </section>
      </div>
    </div>
  );
}

function LifecycleRow({
  testId,
  dotClass,
  label,
  count,
}: {
  testId: string;
  dotClass: string;
  label: string;
  count: number;
}) {
  return (
    <div data-testid={testId} className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={"h-1.5 w-1.5 rounded-full " + dotClass}
      />
      <span>{label}</span>
      <span className="ml-auto text-muted-foreground tabular-nums">
        {count}
      </span>
    </div>
  );
}

function RecentRow({
  entry,
  onOpenPage,
}: {
  entry: PageWithVersions;
  onOpenPage?: (id: string) => void;
}) {
  const { page } = entry;
  const inner = (
    <>
      <span
        aria-hidden="true"
        className={
          "h-1.5 w-1.5 shrink-0 rounded-full " +
          (page.lifecycle === "active" ? "bg-term" : "bg-muted-foreground/40")
        }
      />
      <span className="truncate text-sm font-medium">{page.slug}</span>
      <span className="text-[11px] text-muted-foreground">
        v{page.currentVersion}
      </span>
      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {relativeTime(page.updatedAt)}
      </span>
    </>
  );
  return (
    <li className="border-b border-border/60 last:border-b-0">
      {onOpenPage ? (
        <button
          type="button"
          onClick={() => onOpenPage(page.id)}
          className="flex w-full items-center gap-2.5 rounded-md px-1 py-2.5 text-left transition-colors hover:bg-muted"
        >
          {inner}
        </button>
      ) : (
        <div className="flex items-center gap-2.5 px-1 py-2.5">{inner}</div>
      )}
    </li>
  );
}
