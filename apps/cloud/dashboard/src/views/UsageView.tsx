import { useDashboardData } from "../lib/data";
import { formatBytes, formatTime } from "../lib/format";

/**
 * Usage view (CLOUD-43, PRD §6.4 / §11): the metered-billing surface.
 *
 * Distinct from the oversight views — those are chronological row feeds; this is
 * a small grid of METERS, because billing is "how much of three things", not "a
 * list of events". The three meters are exactly what costs money per §6.4:
 *
 *   - Publishes      — each publish is an expand + a frozen R2 artifact.
 *   - Custom domains — each is a Cloudflare-for-SaaS hostname + cert.
 *   - Storage        — the footprint those frozen artifacts occupy.
 *
 * Page VIEWS are deliberately absent: a viral page costs ~nothing, so it is not
 * metered. Reads `usage` from the data seam (`getUsage` via the live provider,
 * fixtures under test).
 */
export function UsageView() {
  const { usage } = useDashboardData();

  if (usage === undefined) {
    return <div className="empty">Loading usage…</div>;
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
    <div className="panel" data-testid="usage-view">
      <div className="muted" data-testid="usage-cost-note">
        Metered to what costs money (PRD §6.4): publishes, custom domains, and
        storage. Page views are not billed — a viral page costs nothing.
      </div>
      <div className="meters">
        {meters.map((m) => (
          <div className="meter" key={m.key} data-testid={`usage-meter-${m.key}`}>
            <div className="meter-value" data-testid={`usage-value-${m.key}`}>
              {m.value}
            </div>
            <div className="meter-label">{m.label}</div>
            <div className="muted">{m.hint}</div>
          </div>
        ))}
      </div>
      <div className="row muted mono">
        period:{" "}
        {usage.periodStart === null
          ? "since account start"
          : formatTime(usage.periodStart)}{" "}
        → {formatTime(usage.periodEnd)}
      </div>
    </div>
  );
}
