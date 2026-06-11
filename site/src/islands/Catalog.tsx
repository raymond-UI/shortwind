import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogFamily, CatalogRecipe } from "../lib/catalog-data";

// Recipes whose expansion takes the element out of flow (overlays, fixed bars)
// can't render a sensible inline preview — show a note instead.
const NON_PREVIEW = ["fixed", "inset-0", "inset-y-0", "inset-x-0", "absolute"];
function isPreviewable(expansion: string[]): boolean {
  return !expansion.some((c) => NON_PREVIEW.includes(c));
}

function filter(families: CatalogFamily[], q: string): CatalogFamily[] {
  if (!q) return families;
  const n = q.toLowerCase();
  const out: CatalogFamily[] = [];
  for (const fam of families) {
    if (fam.name.toLowerCase().includes(n)) {
      out.push(fam);
      continue;
    }
    const recipes = fam.recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(n) ||
        (r.description ?? "").toLowerCase().includes(n),
    );
    if (recipes.length) out.push({ ...fam, recipes });
  }
  return out;
}

// Recipe-first: every element below is a catalog recipe (@card, @input, @muted,
// @code-block, @caption…). Density comes from overriding on top — `@card p-3`,
// `@input py-1.5 text-xs` — which tailwind-merge resolves. Same pattern this
// page documents.
export default function Catalog({ families }: { families: CatalogFamily[] }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => filter(families, query.trim()), [families, query]);

  return (
    <div>
      <div className="mb-8 max-w-sm">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search — press "/"'
          className="@input py-1.5 font-mono text-xs"
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[8rem_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <div className="sticky top-20 flex flex-col gap-0.5">
            <p className="@eyebrow mb-2">Families</p>
            {filtered.map((f) => (
              <a
                key={f.name}
                href={`#fam-${f.name}`}
                className="@nav-link justify-between gap-0 rounded px-1.5 py-0.5 text-xs"
              >
                <span>{f.name}</span>
                <span className="text-muted-foreground/50">{f.recipes.length}</span>
              </a>
            ))}
          </div>
        </nav>

        <div className="flex min-w-0 flex-col gap-12">
          {filtered.length === 0 ? (
            <p className="@muted font-mono text-xs">No recipes match “{query}”.</p>
          ) : (
            filtered.map((fam) => <FamilySection key={fam.name} family={fam} />)
          )}
        </div>
      </div>
    </div>
  );
}

function FamilySection({ family }: { family: CatalogFamily }) {
  return (
    <section id={`fam-${family.name}`} className="scroll-mt-20">
      <div className="@row-between mb-1 items-baseline">
        <h2 className="@heading-sm font-mono lowercase">{family.name}</h2>
        <CopyButton text={`npx @shortwind/cli@beta add ${family.name}`} label="copy install" />
      </div>
      {family.guidance ? (
        <p className="@caption mb-4 line-clamp-2 max-w-2xl border-l-2 border-border pl-2.5 leading-relaxed">
          {family.guidance.trim()}
        </p>
      ) : (
        <div className="mb-4" />
      )}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {family.recipes.map((r) => (
          <RecipeCard key={r.name} recipe={r} />
        ))}
      </div>
    </section>
  );
}

function RecipeCard({ recipe }: { recipe: CatalogRecipe }) {
  const classes = recipe.expansion.join(" ");
  const previewable = isPreviewable(recipe.expansion);
  return (
    <div className="@card flex flex-col gap-2 p-3">
      <div className="@row-between items-baseline gap-2">
        <h3 className="truncate font-mono text-xs font-semibold text-foreground">
          <span className="@term">@</span>
          {recipe.name}
        </h3>
        <CopyButton text={`@${recipe.name}`} label="copy" />
      </div>
      {recipe.description ? (
        <p className="@muted line-clamp-2 text-xs leading-snug">
          {recipe.description.trim()}
        </p>
      ) : null}
      <pre className="@code-block max-h-16 overflow-auto p-2 text-[11px] leading-relaxed text-muted-foreground">
        {classes}
      </pre>
      <div className="flex h-12 items-center justify-center overflow-hidden rounded border border-dashed border-border px-3">
        {previewable ? (
          // Short, uniform sample — keeps text recipes (@heading-xl) from
          // blowing the card height while still showing weight/size/color.
          <div className={classes}>Aa</div>
        ) : (
          <p className="font-mono text-[11px] text-muted-foreground italic">
            positioning recipe
          </p>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }
      }}
      className="@caption shrink-0 rounded px-1.5 py-0.5 font-mono hover:text-foreground"
    >
      {copied ? "copied" : label}
    </button>
  );
}
