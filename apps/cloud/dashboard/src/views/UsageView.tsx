import { useDashboardData } from "../lib/data";
import { formatBytes, formatTime } from "../lib/format";

/**
 * Usage view (CLOUD-43, PRD §6.4) — the metered-billing surface, restyled as
 * stat cards (epic #184, #189). Three meters = exactly what costs money:
 * publishes, custom domains, storage. Page VIEWS are deliberately absent (a
 * viral page costs ~nothing). Reads `usage` from the data seam.
 */
export function UsageView() {
  const { usage } = useDashboardData();

  if (usage === undefined) {
    return <div className="text-sm text-muted-foreground">Loading usage…</div>;
  }

  const meters = [
    {
      key: "publishes",
      label: "Publishes",
      value: String(usage.publishes),
      hint: "one per published version",
    },
    {
      key: "customDomains",
      label: "Custom domains",
      value: String(usage.customDomains),
      hint: "Cloudflare-for-SaaS hostname + cert",
    },
    {
      key: "storage",
      label: "Storage",
      value: formatBytes(usage.storageBytes),
      hint: "frozen artifact footprint",
    },
  ];

  return (
    <div className="space-y-4" data-testid="usage-view">
      <p className="text-xs text-muted-foreground" data-testid="usage-cost-note">
        Metered to what costs money (PRD §6.4): publishes, custom domains, and
        storage. Page views are not billed — a viral page costs nothing.
      </p>
      {/* @stat / @stat-value / @stat-label — the catalog stat recipes. */}
      <div className="@grid-3 grid gap-4 sm:grid-cols-3">
        {meters.map((m) => (
          <div
            key={m.key}
            data-testid={`usage-meter-${m.key}`}
            className="@stat"
          >
            <div className="@stat-value" data-testid={`usage-value-${m.key}`}>
              {m.value}
            </div>
            <div className="@stat-label">{m.label}</div>
            <div className="text-xs text-muted-foreground">{m.hint}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        period:{" "}
        {usage.periodStart === null
          ? "since account start"
          : formatTime(usage.periodStart)}{" "}
        → {formatTime(usage.periodEnd)}
      </p>
    </div>
  );
}
