import { describe, expect, it } from "vitest";
import {
  normalizeBundlePath,
  resolveBundleLink,
  rewriteHtmlLinks,
  rewriteBundleLinks,
  runPublishBundle,
  bundleArtifactKey,
  type BundleDataPort,
  type BundleDeps,
  type BundleEdgePort,
  type BundleHead,
  type NewBundleVersion,
  type PublishBundleInput,
} from "./bundles.js";
import type { StoragePort } from "./lib/publish_core.js";

/**
 * CLOUD-50 bundle pipeline tests — drive the PURE link-rewrite + `runPublishBundle`
 * with in-memory ports (no Convex harness), plus GOLDEN link-rewrite fixtures
 * (input links → rewritten links). The handler-level convex-test integration
 * lives in bundles.integration.test.ts.
 */

// ---------------------------------------------------------------------------
// In-memory ports.
// ---------------------------------------------------------------------------

interface StoredArtifact {
  key: string;
  html: string;
  meta: Parameters<StoragePort["writeArtifact"]>[2];
}

class MemoryBundleData implements BundleDataPort {
  versions: (NewBundleVersion & { id: string })[] = [];
  private seq = 0;

  async bundleHead(accountId: string, slug: string): Promise<BundleHead | null> {
    const rows = this.versions.filter(
      (r) => r.accountId === accountId && r.slug === slug,
    );
    if (rows.length === 0) return null;
    const current = rows.reduce((m, r) => Math.max(m, r.version), 0);
    return { slug, accountId, currentVersion: current };
  }
  async insertBundleVersion(version: NewBundleVersion): Promise<string> {
    this.seq += 1;
    const id = `bv_${this.seq}`;
    this.versions.push({ ...version, id });
    return id;
  }
}

function makeDeps(): {
  deps: BundleDeps;
  data: MemoryBundleData;
  artifacts: StoredArtifact[];
  routes: Parameters<BundleEdgePort["putEntryRoute"]>[0][];
  invalidations: string[];
} {
  const data = new MemoryBundleData();
  const artifacts: StoredArtifact[] = [];
  const routes: Parameters<BundleEdgePort["putEntryRoute"]>[0][] = [];
  const invalidations: string[] = [];
  const storage: StoragePort = {
    async writeArtifact(key, html, meta) {
      artifacts.push({ key, html, meta });
    },
  };
  const edge: BundleEdgePort = {
    async putEntryRoute(route) {
      routes.push(route);
    },
    async invalidate(url) {
      invalidations.push(url);
    },
  };
  const deps: BundleDeps = {
    data,
    storage,
    edge,
    env: { baseUrl: "https://shortwind.app" },
  };
  return { deps, data, artifacts, routes, invalidations };
}

/** A sealed `@recipe card` whose seal need not match (expansion only needs parse). */
const CARD = "@recipe card {\n  rounded-lg border p-4\n}\n";
function cardSource(): string {
  return `/* shortwind: card@0.4.0 sha:deadbeefdeadbeef */\n${CARD}`;
}

function baseInput(over: Partial<PublishBundleInput> = {}): PublishBundleInput {
  return {
    actor: { accountId: "acct_1", tokenId: "tok_1" },
    files: [
      { path: "index.html", html: '<a href="./about.html">about</a>' },
      { path: "about.html", html: '<a href="index.html">home</a>' },
    ],
    entryPath: "index.html",
    recipes: [{ family: "card", source: cardSource() }],
    lockfile: { card: "0.4.0" },
    ...over,
  };
}

// ===========================================================================
// Pure: path normalization + single-link resolution.
// ===========================================================================

describe("normalizeBundlePath", () => {
  it("strips ./ and resolves ..", () => {
    expect(normalizeBundlePath("./about.html")).toBe("about.html");
    expect(normalizeBundlePath("docs/../index.html")).toBe("index.html");
    expect(normalizeBundlePath("docs/./guide.html")).toBe("docs/guide.html");
    expect(normalizeBundlePath("a/b/../c.html")).toBe("a/c.html");
  });
});

describe("resolveBundleLink", () => {
  it("resolves a relative sibling against the file's dir", () => {
    expect(resolveBundleLink("index.html", "./about.html")).toEqual({
      target: "about.html",
      suffix: "",
    });
    expect(resolveBundleLink("docs/guide.html", "../index.html")).toEqual({
      target: "index.html",
      suffix: "",
    });
    expect(resolveBundleLink("docs/guide.html", "api.html")).toEqual({
      target: "docs/api.html",
      suffix: "",
    });
  });

  it("preserves a #fragment / ?query suffix on the rewrite", () => {
    expect(resolveBundleLink("index.html", "about.html#team")).toEqual({
      target: "about.html",
      suffix: "#team",
    });
    expect(resolveBundleLink("index.html", "about.html?ref=nav")).toEqual({
      target: "about.html",
      suffix: "?ref=nav",
    });
  });

  it("returns null for external / absolute / anchor-only links", () => {
    expect(resolveBundleLink("index.html", "https://example.com")).toBeNull();
    expect(resolveBundleLink("index.html", "//cdn.example.com/x")).toBeNull();
    expect(resolveBundleLink("index.html", "mailto:a@b.com")).toBeNull();
    expect(resolveBundleLink("index.html", "/root-absolute.html")).toBeNull();
    expect(resolveBundleLink("index.html", "#section")).toBeNull();
    expect(resolveBundleLink("index.html", "")).toBeNull();
  });
});

// ===========================================================================
// GOLDEN: link-before-deploy rewrite (input links → rewritten links).
// ===========================================================================

describe("rewriteBundleLinks — golden link-before-deploy fixtures", () => {
  const files = [
    {
      path: "index.html",
      html: [
        '<a href="./about.html">About</a>',
        '<a href="docs/guide.html#start">Guide</a>',
        '<img src="assets/logo.png" alt="logo">',
        '<a href="https://example.com">External</a>',
        '<a href="mailto:hi@shortwind.dev">Mail</a>',
        '<a href="#top">Top</a>',
        '<a href="/login">Login</a>',
      ].join("\n"),
    },
    {
      path: "about.html",
      html: '<a href="index.html">Home</a> <a href=\'docs/guide.html\'>Guide</a>',
    },
    { path: "docs/guide.html", html: '<a href="../index.html">Home</a>' },
  ];
  const entryUrl = "https://shortwind.app/site";

  it("rewrites IN-bundle relative links to served siblings; leaves the rest", () => {
    const out = rewriteBundleLinks(files, "index.html", entryUrl);
    const index = out.find((f) => f.path === "index.html")!.html;

    // entry's own siblings resolve to <entryUrl>/<path>; the entry itself to <entryUrl>.
    expect(index).toContain('href="https://shortwind.app/site/about.html"');
    // a known sibling in a subdir, fragment preserved.
    expect(index).toContain(
      'href="https://shortwind.app/site/docs/guide.html#start"',
    );
    // assets/logo.png is NOT a bundle file → untouched.
    expect(index).toContain('src="assets/logo.png"');
    // external / mailto / anchor / root-absolute → untouched.
    expect(index).toContain('href="https://example.com"');
    expect(index).toContain('href="mailto:hi@shortwind.dev"');
    expect(index).toContain('href="#top"');
    expect(index).toContain('href="/login"');

    // about.html links back to the ENTRY (→ bare entryUrl) and to the subdir sibling.
    const about = out.find((f) => f.path === "about.html")!.html;
    expect(about).toContain('href="https://shortwind.app/site"');
    expect(about).toContain("href='https://shortwind.app/site/docs/guide.html'");

    // a nested file's ../index.html resolves to the entry (bare entryUrl).
    const guide = out.find((f) => f.path === "docs/guide.html")!.html;
    expect(guide).toContain('href="https://shortwind.app/site"');
  });

  it("is deterministic (stable bytes) over the whole fixture set", () => {
    const a = JSON.stringify(rewriteBundleLinks(files, "index.html", entryUrl));
    const b = JSON.stringify(rewriteBundleLinks(files, "index.html", entryUrl));
    expect(a).toBe(b);
  });
});

describe("rewriteHtmlLinks — single quotes + multiple attrs", () => {
  it("rewrites href/src/action/poster and keeps quote style", () => {
    const served = (t: string) =>
      t === "next.html" ? "https://x/site/next.html" : null;
    const html =
      `<form action='next.html'><video poster="next.html"></video>` +
      `<a href="next.html">x</a><script src="next.html"></script>`;
    const out = rewriteHtmlLinks(html, "index.html", served);
    expect(out).toContain("action='https://x/site/next.html'");
    expect(out).toContain('poster="https://x/site/next.html"');
    expect(out).toContain('href="https://x/site/next.html"');
    expect(out).toContain('src="https://x/site/next.html"');
  });
});

// ===========================================================================
// Pipeline: publish, routing, artifacts, version retention / rollback.
// ===========================================================================

describe("runPublishBundle", () => {
  it("publishes a bundle: rewrites links, writes one artifact per file, routes the entry", async () => {
    const { deps, data, artifacts, routes, invalidations } = makeDeps();
    const out = await runPublishBundle(baseInput({ slug: "site" }), deps);

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unexpected");
    expect(out.result.version).toBe(1);
    expect(out.result.bundleId).toBe("site");
    expect(out.result.url).toBe("https://shortwind.app/site");
    expect(out.result.files).toHaveLength(2);

    // exactly one entry file, marked.
    const entry = out.result.files.find((f) => f.entry)!;
    expect(entry.path).toBe("index.html");
    expect(out.result.files.filter((f) => f.entry)).toHaveLength(1);

    // an artifact was written to R2 for EACH file.
    expect(artifacts).toHaveLength(2);
    for (const f of out.result.files) {
      expect(artifacts.some((a) => a.key === f.artifactKey)).toBe(true);
    }

    // the SERVED entry artifact's HTML carries the REWRITTEN cross-file link
    // (link resolves to the served sibling, not the dead authored path).
    const entryArtifact = artifacts.find((a) => a.key === entry.artifactKey)!;
    expect(entryArtifact.html).toContain(
      "https://shortwind.app/site/about.html",
    );
    expect(entryArtifact.html).not.toContain('href="./about.html"');

    // the sibling (about.html) links back to the bare entry URL.
    const sibling = out.result.files.find((f) => !f.entry)!;
    const siblingArtifact = artifacts.find((a) => a.key === sibling.artifactKey)!;
    expect(siblingArtifact.html).toContain('"https://shortwind.app/site"');

    // a version row was appended; entry route + invalidation fired.
    expect(data.versions).toHaveLength(1);
    expect(data.versions[0]!.entryPath).toBe("index.html");
    expect(routes).toHaveLength(1);
    expect(routes[0]!.slug).toBe("site");
    expect(routes[0]!.entryArtifactKey).toBe(entry.artifactKey);
    expect(routes[0]!.siblings.map((s) => s.path)).toEqual(["about.html"]);
    expect(invalidations).toEqual(["https://shortwind.app/site"]);
  });

  it("derives a slug from the entry path when none is given", async () => {
    const { deps } = makeDeps();
    const out = await runPublishBundle(
      baseInput({ slug: undefined, entryPath: "index.html" }),
      deps,
    );
    if (!out.ok) throw new Error("unexpected");
    expect(out.result.bundleId).toBe("index");
    expect(out.result.url).toBe("https://shortwind.app/index");
  });

  it("is forward-only: re-publishing the same slug bumps the version, retaining prior (rollback)", async () => {
    const { deps, data } = makeDeps();
    const v1 = await runPublishBundle(baseInput({ slug: "site" }), deps);
    const v2 = await runPublishBundle(
      baseInput({
        slug: "site",
        files: [
          { path: "index.html", html: '<a href="./about.html">about v2</a>' },
          { path: "about.html", html: "<p>about v2</p>" },
        ],
      }),
      deps,
    );
    if (!v1.ok || !v2.ok) throw new Error("unexpected");
    expect(v1.result.version).toBe(1);
    expect(v2.result.version).toBe(2);

    // BOTH versions are retained (frozen) — rollback target still present.
    expect(data.versions).toHaveLength(2);
    expect(data.versions.map((r) => r.version).sort()).toEqual([1, 2]);
    // v1's frozen file artifact keys differ from v2's (content changed).
    const v1Entry = data.versions.find((r) => r.version === 1)!.files.find((f) => f.entry)!;
    const v2Entry = data.versions.find((r) => r.version === 2)!.files.find((f) => f.entry)!;
    expect(v1Entry.artifactKey).not.toBe(v2Entry.artifactKey);
  });

  it("throws when the entry path is not one of the files", async () => {
    const { deps } = makeDeps();
    await expect(
      runPublishBundle(baseInput({ entryPath: "missing.html" }), deps),
    ).rejects.toThrow(/entry "missing.html" is not one of the bundle files/);
  });

  it("throws on an empty bundle", async () => {
    const { deps } = makeDeps();
    await expect(
      runPublishBundle(baseInput({ files: [], entryPath: "index.html" }), deps),
    ).rejects.toThrow(/at least one file/);
  });
});

describe("bundleArtifactKey", () => {
  it("namespaces the bundle by account + slug + normalized path", () => {
    expect(bundleArtifactKey("acct_1", "site", "./docs/x.html", "abc123")).toBe(
      "bundles/acct_1/site/docs/x.html/abc123.html",
    );
  });
});
