import type { CollectionEntry } from "astro:content";

export type Doc = CollectionEntry<"docs">;

// Stable sidebar order: frontmatter `order`, then slug as a tiebreak.
export function sortedDocs(docs: Doc[]): Doc[] {
  return [...docs].sort(
    (a, b) => a.data.order - b.data.order || a.id.localeCompare(b.id),
  );
}

export function prevNext(
  ordered: Doc[],
  current: Doc,
): { prev: Doc | null; next: Doc | null } {
  const i = ordered.findIndex((d) => d.id === current.id);
  return {
    prev: i > 0 ? ordered[i - 1]! : null,
    next: i >= 0 && i < ordered.length - 1 ? ordered[i + 1]! : null,
  };
}

// The docs landing lives at /docs (the `index` entry); every other doc is
// /docs/<slug>.
export function docHref(id: string): string {
  return id === "index" ? "/docs" : `/docs/${id}`;
}
