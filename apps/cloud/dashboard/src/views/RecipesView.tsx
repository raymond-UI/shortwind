import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { formatTime, relativeTime, shortHash } from "../lib/format";
import { Badge } from "../components/Badge";
import { CopyValue } from "../components/CopyValue";
import { SectionHeader } from "../components/SectionHeader";
import { SkeletonRows } from "../components/Skeleton";
import type { RecipeFamilyRow } from "../lib/types";

/**
 * Recipes view (P4) — the account's recipe palette. Every account is seeded with
 * the standard @shortwind/catalog kit on creation, and publishing a page can
 * carry edited recipe bodies that overwrite a family (recorded here as the
 * latest version). This view shows the palette (standard vs custom) and lets the
 * operator restore a standard family — or the whole kit — back to the seeded
 * body when an edit drifted. Reset is forward-only (appends a new version); it
 * never rewrites history and never fires a recipe-edit audit event.
 */
export function RecipesView() {
  const { recipeVersions, resetRecipes } = useDashboardData();
  const [busyAll, setBusyAll] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (recipeVersions === undefined) {
    return <SkeletonRows count={4} label="Loading recipes" />;
  }

  const standard = recipeVersions.filter((r) => r.isStandard);
  const custom = recipeVersions.filter((r) => !r.isStandard);

  async function onResetAll() {
    if (busyAll) return;
    const ok = window.confirm(
      "Reset every standard family back to the seeded kit body? Custom families are untouched.",
    );
    if (!ok) return;
    setBusyAll(true);
    setNote(null);
    try {
      const { reset } = await resetRecipes();
      setNote(
        reset === 0
          ? "All standard families already match the kit."
          : `Reset ${reset} ${reset === 1 ? "family" : "families"} to the standard kit.`,
      );
    } finally {
      setBusyAll(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-8" data-testid="recipes-view">
      <SectionHeader
        eyebrow="Palette"
        title="Recipes"
        description={
          <>
            The recipe families your account expands `@recipe` shorthand against.
            Every account starts with the full standard kit; publishing a page
            can carry edited bodies that overwrite a family here. Plain HTML
            uploads never touch this palette.
          </>
        }
        actions={
          standard.length > 0 ? (
            <button
              type="button"
              onClick={onResetAll}
              disabled={busyAll}
              data-testid="reset-all-recipes"
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-secondary disabled:opacity-50"
            >
              {busyAll ? "Resetting…" : "Reset all to standard"}
            </button>
          ) : undefined
        }
      />

      {note ? (
        <p
          data-testid="recipes-note"
          className="rounded-md border border-term/30 bg-term/10 px-3 py-2 text-xs text-term"
        >
          {note}
        </p>
      ) : null}

      {recipeVersions.length === 0 ? (
        <div
          data-testid="recipes-empty"
          className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground"
        >
          <span>
            No recipes in this palette yet. Accounts created before the standard
            kit shipped can seed it from the CLI:
          </span>
          <div className="rounded-md border border-border bg-secondary/50 px-2 py-1">
            <CopyValue value="npx convex run migrations:seedStandardKitBackfill" />
          </div>
        </div>
      ) : (
        <>
          <RecipeGroup
            testid="recipes-standard"
            eyebrow="Standard kit"
            title="Standard families"
            count={standard.length}
            rows={standard}
            resettable
          />
          {custom.length > 0 ? (
            <RecipeGroup
              testid="recipes-custom"
              eyebrow="Custom"
              title="Custom families"
              count={custom.length}
              rows={custom}
              resettable={false}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function RecipeGroup({
  testid,
  eyebrow,
  title,
  count,
  rows,
  resettable,
}: {
  testid: string;
  eyebrow: string;
  title: string;
  count: number;
  rows: RecipeFamilyRow[];
  resettable: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3" data-testid={testid}>
      <SectionHeader
        eyebrow={eyebrow}
        title={title}
        actions={<span className="text-xs text-muted-foreground">{count}</span>}
      />
      <ul className="@list-bordered list-none">
        {rows.map((r) => (
          <RecipeRow key={r.family} row={r} resettable={resettable} />
        ))}
      </ul>
    </section>
  );
}

function RecipeRow({
  row,
  resettable,
}: {
  row: RecipeFamilyRow;
  resettable: boolean;
}) {
  const { resetRecipes } = useDashboardData();
  const [busy, setBusy] = useState(false);

  async function onReset() {
    if (busy) return;
    setBusy(true);
    try {
      await resetRecipes(row.family);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li data-testid="recipe-row" className="@list-item items-center gap-3">
      <span
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-term/30 bg-term/10 font-mono text-xs text-term"
      >
        {"{}"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{row.family}</span>
          <Badge outline>v{row.version}</Badge>
          {row.isStandard ? null : <Badge tone="info">custom</Badge>}
        </div>
        <div className="mt-1 text-xs text-muted-foreground tabular-nums">
          body {shortHash(row.bodySha)} ·{" "}
          <span title={formatTime(row.createdAt)}>
            {relativeTime(row.createdAt)}
          </span>
        </div>
      </div>
      {resettable ? (
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          data-testid={`reset-${row.family}`}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {busy ? "Resetting…" : "Reset"}
        </button>
      ) : null}
    </li>
  );
}
