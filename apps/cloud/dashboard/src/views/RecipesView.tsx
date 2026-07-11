import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useDashboardData } from "../lib/data";
import { Badge } from "../components/Badge";
import { Skeleton, SkeletonRows } from "../components/Skeleton";
import {
  buildPreviewShell,
  example,
  expand,
  parsePalette,
  primaryRecipe,
} from "../lib/recipe-preview";

/**
 * Recipes panel (inside Settings) — a catalog-style master/detail over the
 * account's palette: a searchable family rail on the left, and a detail pane on
 * the right with a LIVE preview (rendered in a sandboxed @tailwindcss/browser
 * iframe, themed with the account's accent + radius), the expanded utilities,
 * the shorthand, and a reset. Behaves like the docs catalog/playground.
 */
export function RecipesView() {
  const { recipeVersions, resetRecipes, theme } = useDashboardData();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);

  const rows = recipeVersions ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, "");
    return q ? rows.filter((r) => r.family.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const { flattened, familyRecipes } = useMemo(() => parsePalette(rows), [rows]);

  // Keep a valid selection as data loads / the filter narrows.
  const active =
    selected && filtered.some((r) => r.family === selected)
      ? selected
      : (filtered[0]?.family ?? null);

  // /ui: render the rail chrome (search) + panel frame immediately; mask only
  // the dynamic family list + detail with skeletons until the palette loads.
  const loading = recipeVersions === undefined;
  const hasStandard = rows.some((r) => r.isStandard);

  async function onResetAll() {
    if (busyAll) return;
    if (!window.confirm("Reset every standard family to the kit body?")) return;
    setBusyAll(true);
    try {
      await resetRecipes();
    } finally {
      setBusyAll(false);
    }
  }

  const activeRow = rows.find((r) => r.family === active) ?? null;

  return (
    <div
      data-testid="recipes-view"
      className="flex h-[calc(100vh-13rem)] min-h-[32rem] flex-col overflow-hidden rounded-lg border border-border md:grid md:grid-cols-[15rem_minmax(0,1fr)]"
    >
      {/* rail */}
      <aside className="flex min-h-0 flex-col border-b border-border bg-secondary/30 md:border-b-0 md:border-r">
        <div className="shrink-0 space-y-2 border-b border-border p-2.5">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search families"
            data-testid="recipes-search"
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus:border-term/60"
          />
          {!loading && hasStandard ? (
            <button
              type="button"
              onClick={onResetAll}
              disabled={busyAll}
              data-testid="reset-all-recipes"
              className="w-full rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              {busyAll ? "Resetting…" : "Reset all to standard"}
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {loading ? (
            <div className="p-1">
              <SkeletonRows count={10} label="Loading recipes" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {rows.length === 0 ? "No recipes in this palette." : "No matches."}
            </p>
          ) : (
            filtered.map((r) => (
              <button
                key={r.family}
                type="button"
                onClick={() => setSelected(r.family)}
                data-testid={`recipe-item-${r.family}`}
                className={
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-xs " +
                  (r.family === active
                    ? "bg-term/10 text-term"
                    : "text-muted-foreground hover:bg-term/10 hover:text-foreground")
                }
              >
                <span className="truncate">@{r.family}</span>
                {r.isStandard ? null : (
                  <span
                    aria-label="custom"
                    className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-term"
                  />
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* detail */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <RecipeDetailSkeleton />
        ) : activeRow ? (
          <RecipeDetail
            family={activeRow.family}
            version={activeRow.version}
            isStandard={activeRow.isStandard}
            body={activeRow.body}
            flattened={flattened}
            familyRecipes={familyRecipes}
            accent={theme?.accent ?? "oklch(0.205 0 0)"}
            radius={theme?.radius ?? "0.625rem"}
            onReset={() => resetRecipes(activeRow.family)}
          />
        ) : null}
      </main>
    </div>
  );
}

/** Detail skeleton — mirrors the layout (title, preview block, chip rows). */
function RecipeDetailSkeleton() {
  return (
    <div
      className="flex h-full flex-col gap-5 p-4 sm:p-5"
      role="status"
      aria-label="Loading recipe"
      aria-busy="true"
    >
      <Skeleton className="h-6 w-32" />
      <Skeleton className="min-h-[16rem] flex-1" />
      <Skeleton className="h-9 w-full" />
      <div className="flex gap-1.5">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-6 w-14" />
      </div>
    </div>
  );
}

function RecipeDetail({
  family,
  version,
  isStandard,
  body,
  flattened,
  familyRecipes,
  accent,
  radius,
  onReset,
}: {
  family: string;
  version: string;
  isStandard: boolean;
  body: string;
  flattened: Record<string, string[]>;
  familyRecipes: Record<string, string[]>;
  accent: string;
  radius: string;
  onReset: () => Promise<{ reset: number }>;
}) {
  const [busy, setBusy] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [ready, setReady] = useState(false);
  const [dark, setDark] = useState(
    typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const primary = primaryRecipe(family, familyRecipes);
  const utils = flattened[primary] ?? [];
  const others = (familyRecipes[family] ?? []).filter((n) => n !== primary);

  const html = useMemo(
    () => expand(example(primary, family), flattened),
    [primary, family, flattened],
  );
  // dark is baked into the shell, so a theme/mode change reloads the iframe
  // (keyed below); switching recipes only swaps `html` via postMessage — no
  // reload, no white flash.
  const shell = useMemo(
    () => buildPreviewShell(accent, radius, dark),
    [accent, radius, dark],
  );

  // Mirror the dashboard's light/dark into the sandboxed preview.
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDark(el.classList.contains("dark"));
    sync();
    const o = new MutationObserver(sync);
    o.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);

  const post = (markup: string) =>
    iframeRef.current?.contentWindow?.postMessage(
      { t: "sw-preview", html: markup },
      "*",
    );

  // Swap markup when the recipe changes (no reload). Reloads (theme/dark change)
  // re-post from onLoad, since `ready` won't change to re-fire this effect.
  useEffect(() => {
    if (ready) post(html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  async function reset() {
    if (busy) return;
    setBusy(true);
    try {
      await onReset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="recipe-detail"
      className="flex h-full flex-col gap-5 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="font-mono text-lg font-semibold">
          <span className="text-term">@</span>
          {family}
        </h3>
        <Badge outline>v{version}</Badge>
        {isStandard ? null : <Badge tone="info">custom</Badge>}
        {isStandard ? (
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            data-testid={`reset-${family}`}
            className="ml-auto shrink-0 rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {busy ? "Resetting…" : "Reset"}
          </button>
        ) : null}
      </div>

      <div className="flex min-h-[16rem] flex-1 flex-col">
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          Preview
        </p>
        <iframe
          key={`${accent}|${radius}|${dark}`}
          ref={iframeRef}
          title={`@${family} preview`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={shell}
          onLoad={() => {
            setReady(true);
            post(html);
          }}
          data-testid="recipe-preview"
          className="min-h-0 w-full flex-1 rounded-md border border-dashed border-border bg-background"
        />
      </div>

      <div>
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          Shorthand
        </p>
        <code className="block rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-xs">
          &lt;div class="<span className="text-term">@{family}</span>"&gt;…&lt;/div&gt;
        </code>
      </div>

      <div>
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          Expands to {utils.length} {utils.length === 1 ? "utility" : "utilities"}
        </p>
        <div
          data-testid="recipe-utilities"
          className="flex flex-wrap gap-1.5 rounded-md border border-border bg-secondary/40 p-3"
        >
          {utils.length === 0 ? (
            <span className="text-xs text-muted-foreground">(none)</span>
          ) : (
            utils.map((c) => (
              <span
                key={c}
                className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                {c}
              </span>
            ))
          )}
        </div>
      </div>

      {others.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {others.length} more in this family
          </p>
          <div className="flex flex-wrap gap-1.5">
            {others.map((n) => (
              <span
                key={n}
                className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                @{n}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <button
          type="button"
          onClick={() => setShowSource((v) => !v)}
          aria-expanded={showSource}
          data-testid="recipe-source-toggle"
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          {showSource ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Source
        </button>
        {showSource ? (
          <pre
            data-testid="recipe-source"
            className="mt-1.5 max-h-52 overflow-auto rounded-md border border-border bg-secondary/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
          >
            {body.trim() || "(empty)"}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
