import { describe, expect, it } from "vitest";
import { loadDocsFromSources, parseFrontmatter } from "./docs-data";

const SAMPLE = `---
title: Getting started
description: A short tour.
order: 0
---

# Hi

[install link](/docs/install)
`;

describe("docs data", () => {
  it("parses frontmatter and body", () => {
    const { meta, body } = parseFrontmatter(SAMPLE);
    expect(meta["title"]).toBe("Getting started");
    expect(meta["order"]).toBe("0");
    expect(body.trim().startsWith("# Hi")).toBe(true);
  });

  it("returns frontmatter defaults when there is no header", () => {
    const { meta, body } = parseFrontmatter("# just body\n");
    expect(meta).toEqual({});
    expect(body).toBe("# just body\n");
  });

  it("renders each markdown source to HTML and orders by frontmatter", () => {
    const sources = {
      "a/two.md": `---\ntitle: Two\norder: 2\n---\n\n# Two\n`,
      "a/one.md": `---\ntitle: One\norder: 1\n---\n\n# One\n`,
    };
    const pages = loadDocsFromSources(sources);
    expect(pages.map((p) => p.slug)).toEqual(["one", "two"]);
    expect(pages[0]!.html).toContain("<h1>One</h1>");
  });

  it("strips raw HTML from rendered docs (sanitization)", () => {
    const sources = {
      "a/danger.md": `---\ntitle: Danger\norder: 1\n---\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n# Heading\n`,
    };
    const pages = loadDocsFromSources(sources);
    expect(pages[0]!.html).not.toContain("<script>");
    expect(pages[0]!.html).not.toMatch(/<img[^>]*onerror/i);
    expect(pages[0]!.html).toContain("&lt;script&gt;");
    expect(pages[0]!.html).toContain("<h1>Heading</h1>");
  });

  it("parses frontmatter with CRLF line endings", () => {
    const raw = "---\r\ntitle: Win\r\norder: 1\r\n---\r\n\r\n# body\r\n";
    const { meta, body } = parseFrontmatter(raw);
    expect(meta["title"]).toBe("Win");
    expect(body.trim()).toBe("# body");
  });

  it("every internal /docs link in the loaded pages resolves to a real slug", () => {
    const sources = {
      "a/index.md": `---\ntitle: Home\norder: 0\n---\n\n[install](/docs/install)\n`,
      "a/install.md": `---\ntitle: Install\norder: 1\n---\n\n# Install\n`,
    };
    const pages = loadDocsFromSources(sources);
    const slugs = new Set(pages.map((p) => p.slug));
    for (const p of pages) {
      const links = [...p.body.matchAll(/\(\/docs\/?([\w-]*)\)/g)];
      for (const m of links) {
        const target = m[1] || "index";
        expect(slugs.has(target)).toBe(true);
      }
    }
  });
});
