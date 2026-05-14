import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { loadCatalog } from "../lib/catalog-data";
import type { CatalogData, CatalogFamily, CatalogRecipe } from "../lib/catalog-data";

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
    <section className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Recipe catalog
        </h1>
        <p className="mt-3 text-slate-600">
          Every recipe in the default Shortwind registry, with its expanded
          Tailwind class list and a live preview.
        </p>
        <div className="mt-6">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search recipes — press "/" to focus'
            className="w-full max-w-md rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[12rem_1fr]">
        <FamilySidebar families={filtered.families} />
        <div className="space-y-16">
          {filtered.families.length === 0 ? (
            <p className="text-sm text-slate-500">No recipes match “{query}”.</p>
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
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Families
        </p>
        <ul className="space-y-1 text-sm">
          {families.map((fam) => (
            <li key={fam.name}>
              <a
                href={`#fam-${fam.name}`}
                className="block rounded px-2 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {fam.name}{" "}
                <span className="text-slate-400">({fam.recipes.length})</span>
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
      <div className="mb-6 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold capitalize tracking-tight text-slate-900">
          {family.name}
        </h2>
        <CopyButton
          text={`npx shortwind add ${family.name}`}
          label="Copy install"
        />
      </div>
      <div className="space-y-6">
        {family.recipes.map((r) => (
          <RecipeCard key={r.name} recipe={r} />
        ))}
      </div>
    </section>
  );
}

function RecipeCard({ recipe }: { recipe: CatalogRecipe }) {
  const expansion = recipe.expansion.join(" ");
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          className="font-mono text-sm font-semibold text-slate-900"
          title={recipe.description ?? undefined}
        >
          @{recipe.name}
        </h3>
        <CopyButton text={`@${recipe.name}`} label="Copy" />
      </div>
      {recipe.description ? (
        <p className="mt-1 text-sm text-slate-600">{recipe.description}</p>
      ) : null}

      <pre className="mt-4 overflow-x-auto rounded bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-700">
        {expansion}
      </pre>

      <div className="mt-4">
        <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">
          Preview
        </p>
        <div className="rounded border border-dashed border-slate-200 p-4">
          <div className={expansion}>Preview</div>
        </div>
      </div>
    </article>
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
      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400"
    >
      {copied ? "Copied" : label}
    </button>
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
