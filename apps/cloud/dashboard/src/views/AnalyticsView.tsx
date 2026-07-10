import { SectionHeader } from "../components/SectionHeader";

/**
 * Analytics (epic #184, issue #7). Per-page request/bandwidth/visitor telemetry
 * does not exist in the backend yet (serving is stateless; no metrics table), so
 * this is a deliberately-designed preview — the UI shape real edge analytics
 * (Cloudflare Analytics Engine / Logpush) will drop into. The #213 pass gives it
 * a proper header and a muted sparkline placeholder so the section reads as
 * "coming", not "broken". Usage/billing meters live under Usage; this is traffic.
 */

/** A static, muted bar sketch — the silhouette of the real chart to come. */
const BARS = [30, 52, 41, 68, 47, 80, 62, 74, 55, 90, 71, 84];

export function AnalyticsView() {
  return (
    <div className="space-y-5" data-testid="analytics-view">
      <SectionHeader eyebrow="Analytics" title="Traffic analytics" />

      <div
        className="relative overflow-hidden rounded-lg border border-border bg-card p-6"
        data-testid="analytics-empty"
      >
        {/* Placeholder sparkline — the silhouette of the real chart. */}
        <div
          className="flex h-40 items-end gap-1.5 opacity-40"
          aria-hidden="true"
        >
          {BARS.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t bg-gradient-to-t from-term/20 to-term/60"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>

        {/* Overlay message. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-t from-card via-card/80 to-transparent px-6 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
            <span
              className="h-1.5 w-1.5 rounded-full bg-term"
              aria-hidden="true"
            />
            Coming soon
          </span>
          <p className="mt-3 text-xs text-muted-foreground">
            Edge telemetry lands here soon. Publishing doesn’t change.
          </p>
        </div>
      </div>
    </div>
  );
}
