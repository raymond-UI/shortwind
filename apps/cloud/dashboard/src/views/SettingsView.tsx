import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { formatTime, relativeTime } from "../lib/format";
import { PolicyView } from "./PolicyView";
import { RecipesView } from "./RecipesView";
import { DomainsView } from "./DomainsView";
import { Badge } from "../components/Badge";
import { CopyValue } from "../components/CopyValue";
import { Skeleton, SkeletonRows } from "../components/Skeleton";
import { Segmented } from "../components/Segmented";
import type { TokenRow } from "../lib/types";

const TABS = [
  { value: "domains", label: "Domains" },
  { value: "recipes", label: "Recipes" },
  { value: "theme", label: "Theme" },
  { value: "access", label: "Access" },
] as const;
export type SettingsTab = (typeof TABS)[number]["value"];
/** The tab values, for the route's `?tab=` search-param validation. */
export const SETTINGS_TABS: readonly SettingsTab[] = TABS.map((t) => t.value);
export const DEFAULT_SETTINGS_TAB: SettingsTab = "domains";

/**
 * Settings — account configuration as sub-pages: Domains (+ the custom-domain
 * approval policy), Recipes, Theme, and Access (API tokens). The active sub-page
 * is controlled by the route via `tab`/`onTabChange` (bound to the `?tab=`
 * search param, so it is shareable and reload-safe). Rendered without those
 * props (e.g. in tests) it falls back to local state.
 */
export function SettingsView({
  tab: controlledTab,
  onTabChange,
}: {
  tab?: SettingsTab;
  onTabChange?: (next: SettingsTab) => void;
} = {}) {
  const [localTab, setLocalTab] = useState<SettingsTab>(DEFAULT_SETTINGS_TAB);
  const tab = controlledTab ?? localTab;
  const setTab = onTabChange ?? setLocalTab;

  return (
    <div className="space-y-6" data-testid="settings-view">
      <div className="max-w-xl">
        <Segmented
          options={TABS}
          value={tab}
          onChange={setTab}
          label="Settings sub-pages"
          testId="settings-tabs"
        />
      </div>
      {/* Recipes is a master/detail that wants the full width + height; the other
          sub-pages are forms that read better in a narrow column. */}
      {tab === "domains" ? (
        <div className="max-w-2xl space-y-6">
          <DomainsView />
          <PolicyView />
        </div>
      ) : null}
      {tab === "recipes" ? <RecipesView /> : null}
      {tab === "theme" ? (
        <div className="max-w-2xl">
          <ThemeEditor />
        </div>
      ) : null}
      {tab === "access" ? (
        <div className="max-w-2xl">
          <TokenList />
        </div>
      ) : null}
    </div>
  );
}

/** A #rrggbb hex for the native color input, or null if the value isn't hex. */
function toHex(color: string): string | null {
  const s = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1]!, g = s[2]!, b = s[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

/** Quick-pick accent swatches (hex, so the native picker + presets agree). */
const ACCENT_PRESETS = [
  "#0f172a",
  "#2563eb",
  "#0d9488",
  "#16a34a",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#7c3aed",
];

/** Parse a radius CSS length to a slider px value (rem×16, px as-is), 0–32. */
function radiusToPx(value: string): number {
  const m = value.trim().match(/^(\d*\.?\d+)(rem|px|em)?$/);
  if (!m) return 10;
  const n = parseFloat(m[1]!);
  const px = (m[2] ?? "px") === "px" ? n : n * 16;
  return Math.max(0, Math.min(32, Math.round(px)));
}

/** Emit a slider px value as rem (the theme's canonical radius unit). */
function pxToRadius(px: number): string {
  return `${+(px / 16).toFixed(4)}rem`;
}

function ThemeEditor() {
  const { theme, setTheme } = useDashboardData();
  const [accent, setAccent] = useState("");
  const [radius, setRadius] = useState("");
  const [dirtyFrom, setDirtyFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seed the local fields once the theme loads, and whenever it changes from a
  // save. Track the loaded signature so we only reset the inputs when the
  // upstream value actually changes (not on every keystroke re-render).
  const signature = theme ? `${theme.accent}|${theme.radius}` : null;
  if (signature !== null && signature !== dirtyFrom && !busy) {
    setDirtyFrom(signature);
    setAccent(theme!.accent);
    setRadius(theme!.radius);
    setError(null);
  }

  // /ui: render the static chrome (labels, presets, Save) immediately; mask ONLY
  // the dynamic value controls (accent/radius) until the theme loads.
  const loading = theme === undefined;

  async function onSave() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await setTheme({ accent: accent.trim(), radius: radius.trim() });
      setDirtyFrom(`${next.accent}|${next.radius}`);
      setAccent(next.accent);
      setRadius(next.radius);
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? "Couldn’t save: accent must be a valid CSS color and radius a length like 0.5rem."
          : "Couldn’t save the theme.",
      );
    } finally {
      setBusy(false);
    }
  }

  const canSave = accent.trim().length > 0 && radius.trim().length > 0 && !busy;

  return (
    <div data-testid="theme-editor" className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Applied to fragment uploads. Full HTML documents are served unthemed.
      </p>
      {/* Accent color — a real picker (native swatch), quick presets, and a
          freeform field for exact values (oklch/hex/named). */}
      <div className="space-y-2">
        <span className="text-sm text-muted-foreground">Accent color</span>
        {loading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <div className="flex items-center gap-3">
            <label
              className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border"
              style={{ background: accent || "transparent" }}
              title="Pick a color"
            >
              <input
                type="color"
                value={toHex(accent) ?? "#000000"}
                onChange={(e) => {
                  setAccent(e.target.value);
                  setSaved(false);
                }}
                data-testid="accent-color"
                aria-label="Accent color picker"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
            <input
              type="text"
              value={accent}
              onChange={(e) => {
                setAccent(e.target.value);
                setSaved(false);
              }}
              spellCheck={false}
              data-testid="accent-input"
              placeholder="oklch(0.6 0.2 250) or #2563eb"
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus:border-term/60"
            />
          </div>
        )}
        {/* Presets are static — render immediately. */}
        <div className="flex flex-wrap gap-1.5" data-testid="accent-presets">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setAccent(c);
                setSaved(false);
              }}
              aria-label={`Use ${c}`}
              className="h-6 w-6 rounded-full border border-border ring-offset-2 ring-offset-background transition-[box-shadow] hover:ring-2 hover:ring-term/50"
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      {/* Corner radius — a slider (distinct from the color control), a live
          rounded preview, and the exact rem readout. */}
      <div className="space-y-2">
        <span className="text-sm text-muted-foreground">Corner radius</span>
        {loading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-9 w-9 shrink-0 border border-border bg-secondary"
              style={{ borderRadius: radius || "0" }}
            />
            <input
              type="range"
              min={0}
              max={32}
              step={1}
              value={radiusToPx(radius)}
              onChange={(e) => {
                setRadius(pxToRadius(Number(e.target.value)));
                setSaved(false);
              }}
              data-testid="radius-range"
              aria-label="Corner radius"
              className="w-full accent-term"
            />
            <span
              data-testid="radius-value"
              className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground"
            >
              {radius}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave || loading}
          data-testid="save-theme"
          className="rounded-md border border-term/40 bg-term/10 px-3 py-1.5 text-xs text-term transition-colors hover:bg-term/20 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save theme"}
        </button>
        {!loading && theme.isDefault ? (
          <span className="text-xs text-muted-foreground">
            Using the neutral default.
          </span>
        ) : null}
        {saved ? (
          <span data-testid="theme-saved" className="text-xs text-term">
            Saved.
          </span>
        ) : null}
      </div>

      {error ? (
        <p data-testid="theme-error" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TokenList() {
  const { tokens } = useDashboardData();

  if (tokens === undefined) {
    return <SkeletonRows count={3} label="Loading tokens" />;
  }
  if (tokens.length === 0) {
    // Same ghost pattern as the Overview archive card — compact, with the
    // CLI command right there to copy instead of a hero-sized empty state.
    return (
      <div
        data-testid="tokens-empty"
        className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground"
      >
        <span>No API tokens yet. Mint one from the CLI:</span>
        <div className="rounded-md border border-border bg-secondary/50 px-2 py-1">
          <CopyValue value="shortwind cloud login" />
        </div>
      </div>
    );
  }

  return (
    <ul data-testid="tokens-view" className="@list-bordered list-none">

      {tokens.map((t) => (
        <TokenRowItem key={t.tokenId} token={t} />
      ))}
    </ul>
  );
}

function TokenRowItem({ token }: { token: TokenRow }) {
  const { revokeToken } = useDashboardData();
  const [busy, setBusy] = useState(false);
  const revoked = token.revokedAt !== null;

  async function onRevoke() {
    setBusy(true);
    try {
      await revokeToken(token.tokenId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li data-testid="token-row" className="@list-item items-start gap-3">
      <span
        aria-hidden="true"
        className={
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border text-sm " +
          (revoked
            ? "border-border bg-secondary text-muted-foreground opacity-60"
            : "border-term/30 bg-term/10 text-term")
        }
      >
        🔑
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={
              "truncate font-medium " + (revoked ? "line-through opacity-70" : "")
            }
          >
            {token.label ?? "(unlabeled)"}
          </span>
          {revoked ? <Badge tone="danger">revoked</Badge> : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {token.scopes.map((s) => (
            <Badge key={s} outline>
              {s}
            </Badge>
          ))}
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground tabular-nums">
          <span title={formatTime(token.createdAt)}>
            created {relativeTime(token.createdAt)}
          </span>
          {/* Expiry is in the future — relative phrasing can't say that. */}
          {token.expiresAt !== null
            ? ` · expires ${formatTime(token.expiresAt)}`
            : ""}
        </div>
      </div>
      {revoked ? null : (
        <button
          type="button"
          onClick={onRevoke}
          disabled={busy}
          data-testid={`revoke-${token.tokenId}`}
          className="shrink-0 rounded-md border border-destructive/60 px-2.5 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          {busy ? "Revoking…" : "Revoke"}
        </button>
      )}
    </li>
  );
}
