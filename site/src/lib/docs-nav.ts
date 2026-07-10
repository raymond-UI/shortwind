import type { CollectionEntry } from "astro:content";

export type Doc = CollectionEntry<"docs">;
export type Product = "core" | "cloud";

// The two product trees behind the docs sidebar switcher, in tab order.
export const PRODUCTS: { id: Product; label: string; blurb: string }[] = [
  { id: "core", label: "Core", blurb: "The local class layer" },
  { id: "cloud", label: "Cloud", blurb: "Agent-native hosting" },
];

// Stable sidebar order: frontmatter `order`, then slug as a tiebreak.
export function sortedDocs(docs: Doc[]): Doc[] {
  return [...docs].sort(
    (a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id),
  );
}

// The docs for one product, sorted. `order` is scoped per product.
export function docsForProduct(docs: Doc[], product: Product): Doc[] {
  return sortedDocs(docs.filter((d) => d.data.product === product));
}

// Prev/next stays inside the current doc's product, so paging never crosses the
// Core/Cloud boundary.
export function prevNext(
  ordered: Doc[],
  current: Doc,
): { prev: Doc | null; next: Doc | null } {
  const within = docsForProduct(ordered, current.data.product);
  const i = within.findIndex((d) => d.id === current.id);
  return {
    prev: i > 0 ? within[i - 1]! : null,
    next: i >= 0 && i < within.length - 1 ? within[i + 1]! : null,
  };
}

// The first page of a product tree — the target its switcher tab links to.
export function landingFor(docs: Doc[], product: Product): Doc | undefined {
  return docsForProduct(docs, product)[0];
}

// The docs landing lives at /docs (the `index` entry); every other doc is
// /docs/<slug>.
export function docHref(id: string): string {
  return id === "index" ? "/docs" : `/docs/${id}`;
}
