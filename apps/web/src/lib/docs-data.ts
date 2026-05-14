import { marked } from "marked";

export type DocFrontmatter = {
  title: string;
  description: string | null;
  order: number;
};

export type DocPage = {
  slug: string;
  frontmatter: DocFrontmatter;
  body: string;
  html: string;
};

const docSources = import.meta.glob("../content/docs/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

let cached: DocPage[] | null = null;

export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const k = kv[1]!;
    let v = kv[2]!.trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    meta[k] = v;
  }
  return { meta, body: m[2] ?? "" };
}

function slugFromPath(p: string): string {
  const file = p.split("/").pop() ?? p;
  return file.replace(/\.md$/, "");
}

export function loadDocsFromSources(sources: Record<string, string>): DocPage[] {
  const pages: DocPage[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const slug = slugFromPath(path);
    const { meta, body } = parseFrontmatter(source);
    const title = meta["title"] ?? slug;
    const description = meta["description"] ?? null;
    const order = meta["order"] ? Number(meta["order"]) : 999;
    const html = marked.parse(body, { async: false }) as string;
    pages.push({ slug, frontmatter: { title, description, order }, body, html });
  }
  pages.sort((a, b) => {
    if (a.frontmatter.order !== b.frontmatter.order) {
      return a.frontmatter.order - b.frontmatter.order;
    }
    return a.slug.localeCompare(b.slug);
  });
  return pages;
}

export function loadDocs(): DocPage[] {
  if (cached) return cached;
  cached = loadDocsFromSources(docSources);
  return cached;
}

export function findDoc(slug: string): DocPage | null {
  return loadDocs().find((d) => d.slug === slug) ?? null;
}
