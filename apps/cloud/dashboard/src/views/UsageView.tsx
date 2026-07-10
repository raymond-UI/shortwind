import { useDashboardData } from "../lib/data";
import { formatBytes, formatTime } from "../lib/format";
import { SectionHeader } from "../components/SectionHeader";
import { SkeletonStats } from "../components/Skeleton";

/**
 * Usage view (CLOUD-43, PRD §6.4) — the metered-billing surface, restyled in
 * the #213 design pass as accented stat cards: a leading term-green glyph, a
 * large tabular value, the label, and what it means. Three meters = exactly
 * what costs money: publishes, custom domains, storage. Page VIEWS are
 * deliberately absent (a viral page costs ~nothing). Reads `usage` from the
 * data seam.
 */
export function UsageView() {
  const { usage } = useDashboardData();

  // The header is static — render it immediately and skeleton only the meters.
  const header = (
    <SectionHeader
      eyebrow="Usage"
      title="What this account is using"
      description={
        <span data-testid="usage-cost-note">
          Metered to what costs money (PRD §6.4): publishes, custom domains,
          and storage. Page views are not billed — a viral page costs nothing.
        </span>
      }
    />
  );

  if (usage === undefined) {
    return (
      <div className="space-y-5">
        {header}
        <SkeletonStats label="Loading usage" />
      </div>
    );
  }

  const meters = [
    {
      key: "publishes",
      glyph: "▲",
      label: "Publishes",
      value: String(usage.publishes),
      hint: "one per published version",
    },
    {
      key: "customDomains",
      glyph: "⊞",
      label: "Custom domains",
      value: String(usage.customDomains),
      hint: "Cloudflare-for-SaaS hostname + cert",
    },
    {
      key: "storage",
      glyph: "⛁",
      label: "Storage",
      value: formatBytes(usage.storageBytes),
      hint: "frozen artifact footprint",
    },
  ];

  return (
    <div className="space-y-5" data-testid="usage-view">
      {header}

      <div className="grid gap-4 sm:grid-cols-3">
        {meters.map((m) => (
          <div
            key={m.key}
            data-testid={`usage-meter-${m.key}`}
            className="rounded-lg border border-border bg-card p-5"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{m.label}</span>
              <span className="text-term" aria-hidden="true">
                {m.glyph}
              </span>
            </div>
            <div
              className="mt-3 text-3xl font-semibold tabular-nums leading-none tracking-tight"
              data-testid={`usage-value-${m.key}`}
            >
              {m.value}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">{m.hint}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-term" aria-hidden="true" />
        <span className="tabular-nums">
          period:{" "}
          {usage.periodStart === null
            ? "since account start"
            : formatTime(usage.periodStart)}{" "}
          → {formatTime(usage.periodEnd)}
        </span>
      </div>
    </div>
  );
}
