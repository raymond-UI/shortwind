import { useDashboardData } from "../lib/data";
import { formatTime, relativeTime } from "../lib/format";
import { Badge } from "../components/Badge";
import { CopyValue } from "../components/CopyValue";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRows } from "../components/Skeleton";
import type { ModerationState } from "../lib/types";

/**
 * Moderation view (epic #184, #192) — restyled as an OWNER-scoped safety view:
 * the signed-in account's own reported/quarantined pages (auth is account-scoped;
 * there is no cross-account operator console yet). Preserve-not-delete (§8.2):
 * `preservedR2Key` surfaces the sealed-store pointer so the object is shown as
 * sealed, not lost.
 */
const STATE_LABEL: Record<ModerationState, string> = {
  reported: "reported",
  quarantined: "quarantined",
  preserved: "preserved",
  cleared: "cleared",
};

export function ModerationView() {
  const { moderation } = useDashboardData();

  if (moderation === undefined) {
    return <SkeletonRows count={3} label="Loading moderation queue" />;
  }
  if (moderation.length === 0) {
    return (
      <EmptyState
        icon="🛡"
        title="No moderation cases"
        description="None of your pages have been reported or quarantined."
      />
    );
  }

  return (
    <ul data-testid="moderation-view" className="list-none space-y-2">
      {moderation.map((m) => {
        const danger = m.state === "reported" || m.state === "quarantined";
        return (
          <li
            key={m.id}
            data-testid="moderation-row"
            className={
              "@card flex gap-3 !p-3 text-sm" +
              (danger ? " border-l-2 border-l-destructive" : "")
            }
          >
            <span
              aria-hidden="true"
              className={
                "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border text-sm " +
                (danger
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border bg-secondary text-muted-foreground")
              }
            >
              🛡
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={danger ? "danger" : "neutral"}>
                  {STATE_LABEL[m.state]}
                </Badge>
                <CopyValue value={m.pageId} className="min-w-0" />
              </div>
              <div className="@caption">{m.reason ?? "—"}</div>
              {m.preservedR2Key ? (
                <div className="@caption tabular-nums">
                  sealed: {m.preservedR2Key}
                </div>
              ) : null}
              {m.ncmecReportId ? (
                <div className="@caption tabular-nums">
                  ncmec: {m.ncmecReportId}
                </div>
              ) : null}
            </div>
            <span
              className="@caption shrink-0 tabular-nums"
              title={formatTime(m.updatedAt)}
            >
              {relativeTime(m.updatedAt)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
