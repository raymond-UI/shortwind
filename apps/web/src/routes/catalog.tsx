import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { loadCatalog } from "../lib/catalog-data";
import type { CatalogData, CatalogFamily, CatalogRecipe } from "../lib/catalog-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const getCatalog = createServerFn({ method: "GET" }).handler(() => loadCatalog());

export const Route = createFileRoute("/catalog")({
  loader: () => getCatalog(),
  component: CatalogPage,
});

function CatalogPage() {
  const data = Route.useLoaderData() as CatalogData;
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

  const filtered = useMemo(() => filterCatalog(data, query.trim()), [data, query]);

  return (
    <section className="@container py-12">
      <header className="mb-10 @stack-md">
        <h1 className="@heading-lg text-3xl">Recipe catalog</h1>
        <p className="@body text-base text-muted-foreground">
          Every recipe in the default Shortwind registry, with its expanded
          Tailwind class list and a live preview.
        </p>
        <div>
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search recipes — press "/" to focus'
            className="max-w-md"
          />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[12rem_1fr]">
        <FamilySidebar families={filtered.families} />
        <div className="@stack-lg gap-16">
          {filtered.families.length === 0 ? (
            <p className="@muted">No recipes match “{query}”.</p>
          ) : null}
          {filtered.families.map((fam) => (
            <FamilySection key={fam.name} family={fam} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FamilySidebar({ families }: { families: CatalogFamily[] }) {
  return (
    <nav className="hidden lg:block">
      <div className="sticky top-6 max-h-[80vh] overflow-y-auto">
        <p className="@caption mb-3 font-semibold uppercase tracking-wider">
          Families
        </p>
        <ul className="@stack-xs text-sm">
          {families.map((fam) => (
            <li key={fam.name}>
              <a href={`#fam-${fam.name}`} className="@nav-link block">
                {fam.name}{" "}
                <span className="text-muted-foreground">
                  ({fam.recipes.length})
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

function FamilySection({ family }: { family: CatalogFamily }) {
  return (
    <section id={`fam-${family.name}`} className="scroll-mt-6">
      <div className="@row-between mb-6 items-baseline">
        <h2 className="@heading-md capitalize">{family.name}</h2>
        <CopyButton
          text={`npx @shortwind/cli@beta add ${family.name}`}
          label="Copy install"
        />
      </div>
      <div className="@stack-md gap-6">
        {family.recipes.map((r) => (
          <RecipeCard key={r.name} recipe={r} />
        ))}
      </div>
    </section>
  );
}

// Recipes that anchor to the viewport (modals, overlays, tooltips) can't be
// rendered inline as a plain `<div>` — `fixed inset-0` would yank the preview
// out of its card and onto the page. Detect those and show a "no preview"
// stub instead of breaking layout.
const NON_PREVIEWABLE_TOKENS = ["fixed", "inset-0", "inset-y-0", "inset-x-0"];
function isPreviewable(expansion: readonly string[]): boolean {
  return !expansion.some((t) => NON_PREVIEWABLE_TOKENS.includes(t));
}

function RecipeCard({ recipe }: { recipe: CatalogRecipe }) {
  const expansion = recipe.expansion.join(" ");
  const previewable = isPreviewable(recipe.expansion);
  return (
    <Card>
      <CardContent className="p-5">
        <div className="@row-between flex-wrap items-baseline">
          <h3
            className="@heading-sm font-mono text-sm"
            title={recipe.description ?? undefined}
          >
            @{recipe.name}
          </h3>
          <CopyButton text={`@${recipe.name}`} label="Copy" />
        </div>
        {recipe.description ? (
          <p className="@body mt-1">{recipe.description}</p>
        ) : null}

        <pre className="@code-block mt-4 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap wrap-break-word">
          {expansion}
        </pre>

        <div className="mt-4">
          <p className="@caption mb-2 uppercase tracking-wider">Preview</p>
          <div className="relative isolate overflow-hidden rounded border border-dashed border-border p-4">
            {previewable ? (
              <div className={expansion}>Preview</div>
            ) : (
              <p className="@muted text-sm italic">
                Positioning recipe — preview not rendered inline.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

function filterCatalog(data: CatalogData, query: string): CatalogData {
  if (!query) return data;
  const needle = query.toLowerCase();
  const families: CatalogFamily[] = [];
  for (const fam of data.families) {
    if (fam.name.toLowerCase().includes(needle)) {
      families.push(fam);
      continue;
    }
    const recipes = fam.recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        (r.description ?? "").toLowerCase().includes(needle),
    );
    if (recipes.length > 0) families.push({ name: fam.name, recipes });
  }
  return { families };
}
