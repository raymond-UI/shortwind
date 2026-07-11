import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { formatTime, relativeTime } from "../lib/format";
import { PolicyView } from "./PolicyView";
import { Badge } from "../components/Badge";
import { CopyValue } from "../components/CopyValue";
import { SectionHeader } from "../components/SectionHeader";
import { SkeletonRows } from "../components/Skeleton";
import type { TokenRow } from "../lib/types";

/**
 * Settings (epic #184, issue #6) — account configuration: policy toggles (folded
 * in from the old standalone Policy view) and API tokens (list + revoke). The
 * token list/revoke go through the operator-gated, account-scoped
 * `dashboard.listTokens` / `dashboard.revokeToken` (the raw token functions are
 * internal-only now — the un-gated public ones were a cross-account hole).
 */
export function SettingsView() {
  return (
    <div className="max-w-2xl space-y-10" data-testid="settings-view">
      <section className="space-y-4">
        <SectionHeader eyebrow="Policy" title="Account policy" />
        <PolicyView />
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Theme"
          title="Web theme"
          description="The accent color and corner radius applied to pages you upload from the web. Full HTML documents that carry their own <head> are served exactly as uploaded and are not themed."
        />
        <ThemeEditor />
      </section>

      <section className="space-y-4">
        <SectionHeader eyebrow="Access" title="API tokens" />
        <TokenList />
      </section>
    </div>
  );
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

  if (theme === undefined) {
    return <SkeletonRows count={2} label="Loading theme" />;
  }

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
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="text-muted-foreground">Accent color</span>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              data-testid="accent-swatch"
              className="h-8 w-8 shrink-0 rounded-md border border-border"
              style={{ background: accent || "transparent" }}
            />
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
        </label>

        <label className="space-y-1.5 text-sm">
          <span className="text-muted-foreground">Corner radius</span>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-8 w-8 shrink-0 border border-border bg-secondary"
              style={{ borderRadius: radius || "0" }}
            />
            <input
              type="text"
              value={radius}
              onChange={(e) => {
                setRadius(e.target.value);
                setSaved(false);
              }}
              spellCheck={false}
              data-testid="radius-input"
              placeholder="0.625rem"
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none focus:border-term/60"
            />
          </div>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          data-testid="save-theme"
          className="rounded-md border border-term/40 bg-term/10 px-3 py-1.5 text-xs text-term transition-colors hover:bg-term/20 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save theme"}
        </button>
        {theme.isDefault ? (
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
