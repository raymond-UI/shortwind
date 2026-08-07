import { describe, expect, it } from "vitest";
import {
  runPublishBundle,
  bundleArtifactKey,
  type BundleDeps,
  type NewBundleVersion,
  type PublishBundleInput,
} from "./bundles.js";
import { normalizeBundlePath } from "./lib/bundle_path.js";
import { bundleCurrentKey } from "../shared/src/artifact_keys.js";
import type {
  AuditWrite,
  EdgePort,
  NewPageVersion,
  PageRecord,
  PublishDataPort,
  PublishDeps,
  RecipeEditEventWrite,
  RecipeVersionWrite,
  StoragePort,
  StoredRecipeVersion,
} from "./lib/publish_core.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * CLOUD-50 bundle pipeline tests — drive the PURE `runPublishBundle` with
 * in-memory ports (no Convex harness). The entry is published through the
 * single-file `runPublish` (entry-as-page); siblings are written to R2 and
 * recorded in a bundle version. No link rewriting: files serve at their authored
 * paths, so the author's relative links are stored verbatim.
 */

interface StoredArtifact {
  key: string;
  html: string;
  meta: Parameters<StoragePort["writeArtifact"]>[2];
}

/** Minimal in-memory PublishDataPort (create path — the bundle entry publish). */
class MemoryPublishData implements PublishDataPort {
  pages = new Map<string, PageRecord & { visibility: string; tags: string[] }>();
  pageVersions: (NewPageVersion & { id: string })[] = [];
  audits: AuditWrite[] = [];
  lockfiles = new Map<string, Lockfile>();
  private seq = 0;
  private id(p: string) {
    this.seq += 1;
    return `${p}_${this.seq}`;
  }
  async findPageBySlug(accountId: string, slug: string) {
    for (const p of this.pages.values()) {
      if (p.accountId === accountId && p.slug === slug) return p;
    }
    return null;
  }
  async getPage(pageId: string) {
    return this.pages.get(pageId) ?? null;
  }
  async subdomainTaken(label: string) {
    for (const p of this.pages.values()) if (p.subdomain === label) return true;
    return false;
  }
  async insertPage(page: {
    accountId: string;
    slug: string;
    visibility: "public" | "unlisted" | "private";
    tags: string[];
  }) {
    const id = this.id("page");
    this.pages.set(id, {
      id,
      accountId: page.accountId,
      slug: page.slug,
      subdomain: page.slug,
      currentVersion: 0,
      visibility: page.visibility,
      tags: page.tags,
    });
    return { id, subdomain: page.slug };
  }
  async patchPageCurrentVersion(pageId: string, _vId: string, cur: number) {
    const p = this.pages.get(pageId);
    if (p) p.currentVersion = cur;
  }
  async insertPageVersion(version: NewPageVersion) {
    const id = this.id("ver");
    this.pageVersions.push({ ...version, id });
    return id;
  }
  async latestRecipeVersion(
    _accountId: string,
    _family: string,
  ): Promise<StoredRecipeVersion | null> {
    return null;
  }
  async loadPalette(
    _accountId: string,
  ): Promise<{ family: string; body: string }[]> {
    return []; // bundle tests carry recipes explicitly; no stored palette.
  }
  async insertRecipeVersion(_w: RecipeVersionWrite) {
    return this.id("rv");
  }
  async insertRecipeEditEvent(_w: RecipeEditEventWrite) {
    return this.id("re");
  }
  async insertAudit(w: AuditWrite) {
    this.audits.push(w);
    return this.id("audit");
  }
  async getStoredLockfile(pageId: string) {
    return this.lockfiles.get(pageId) ?? null;
  }
  async putStoredLockfile(pageId: string, lockfile: Lockfile) {
    this.lockfiles.set(pageId, lockfile);
  }
  async getIdempotency() {
    return null;
  }
  async putIdempotency() {}
}

function makeDeps(): {
  deps: BundleDeps;
  data: MemoryPublishData;
  artifacts: StoredArtifact[];
  bundleRows: NewBundleVersion[];
} {
  const data = new MemoryPublishData();
  const artifacts: StoredArtifact[] = [];
  const bundleRows: NewBundleVersion[] = [];
  const storage: StoragePort = {
    async writeArtifact(key, html, meta) {
      artifacts.push({ key, html, meta });
    },
  };
  const edge: EdgePort = {
    async invalidate() {},
  };
  const publish: PublishDeps = {
    data,
    storage,
    edge,
    env: { baseUrl: "https://shortwind.app", rootDomain: "shortwind.app" },
  };
  const deps: BundleDeps = {
    publish,
    async insertBundleVersion(v) {
      bundleRows.push(v);
      return `bv_${bundleRows.length}`;
    },
    async currentBundle(entryPageId) {
      const rows = bundleRows.filter((r) => r.entryPageId === entryPageId);
      if (rows.length === 0) return null;
      const version = rows.reduce((m, r) => Math.max(m, r.version), 0);
      return { version, active: true }; // in-memory pages are always active
    },
  };
  return { deps, data, artifacts, bundleRows };
}

const CARD = "@recipe card {\n  rounded-lg border p-4\n}\n";
function cardSource(): string {
  return `/* shortwind: card@0.4.0 sha:deadbeefdeadbeef */\n${CARD}`;
}
function lockfile(): Lockfile {
  return { version: 1, registry: "default", families: {} };
}

function baseInput(over: Partial<PublishBundleInput> = {}): PublishBundleInput {
  return {
    actor: { accountId: "acct_1", tokenId: "tok_1" },
    files: [
      { path: "index.html", html: '<a href="about.html">about</a>' },
      { path: "about.html", html: '<a href="index.html">home</a>' },
    ],
    entryPath: "index.html",
    recipes: [{ family: "card", source: cardSource() }],
    lockfile: lockfile(),
    ...over,
  };
}

describe("bundleArtifactKey", () => {
  it("namespaces a sibling by account + entry page id + normalized path", () => {
    expect(bundleArtifactKey("acct_1", "page_9", "./docs/x.html", "abc123")).toBe(
      "bundles/acct_1/page_9/docs/x.html/abc123.html",
    );
  });
});

describe("runPublishBundle (entry-as-page)", () => {
  it("re-publishing the same slug UPDATES the bundle in place (v2, same entry/URL)", async () => {
    const { deps, data, bundleRows } = makeDeps();
    const v1 = await runPublishBundle(baseInput({ slug: "site" }), deps);
    if (!v1.ok) throw new Error("v1 collision");
    expect(v1.result.version).toBe(1);

    const v2 = await runPublishBundle(
      baseInput({
        slug: "site",
        files: [
          { path: "index.html", html: '<a href="about.html">home v2</a>' },
          { path: "about.html", html: "<p>about v2</p>" },
        ],
      }),
      deps,
    );
    if (!v2.ok) throw new Error("v2 collision (expected an update)");
    // Same entry page + URL, next version — an update, not a 409 or a new page.
    expect(v2.result.entryPageId).toBe(v1.result.entryPageId);
    expect(v2.result.url).toBe(v1.result.url);
    expect(v2.result.version).toBe(2);
    // One page (updated), two retained bundle-version rows (rollback).
    expect(data.pages.size).toBe(1);
    expect(bundleRows.map((r) => r.version).sort()).toEqual([1, 2]);
  });

  it("publishes the entry as a page and writes each sibling to R2", async () => {
    const { deps, data, artifacts, bundleRows } = makeDeps();
    const out = await runPublishBundle(baseInput({ slug: "site" }), deps);

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("unexpected collision");
    expect(out.result.bundleId).toBe("site");
    expect(out.result.version).toBe(1);
    // Entry serves at its subdomain (entry-as-page), NOT a legacy path URL.
    expect(out.result.url).toBe("https://site.shortwind.app");

    // A real page row was created for the entry (with its version + artifact).
    expect(data.pages.size).toBe(1);
    expect(data.pageVersions).toHaveLength(1);

    // The entry artifact + one artifact per sibling were written to R2.
    // (entry via runPublish's storage; sibling via the bundle path.) #232: EVERY
    // served document is written twice — its immutable hashed object and its
    // stable `current.html`. One entry + one sibling = four objects.
    expect(artifacts).toHaveLength(4);

    // The result lists ONLY the siblings (the entry is the page).
    expect(out.result.files.map((f) => f.path)).toEqual(["about.html"]);
    expect(out.result.files.every((f) => !f.entry)).toBe(true);

    // The sibling artifact key is namespaced under the entry page id.
    const sibling = out.result.files[0]!;
    expect(sibling.artifactKey).toContain("bundles/acct_1/");
    expect(artifacts.some((a) => a.key === sibling.artifactKey)).toBe(true);

    // One bundle version row, linked to the entry page, siblings recorded.
    expect(bundleRows).toHaveLength(1);
    expect(bundleRows[0]!.entryPageId).toBe(out.result.entryPageId);
    expect(bundleRows[0]!.entryPath).toBe("index.html");
    expect(bundleRows[0]!.files.map((f) => f.path)).toEqual(["about.html"]);
  });

  it("#232: each sibling also gets a STABLE current.html, overwritten on republish", async () => {
    const { deps, artifacts } = makeDeps();
    const v1 = await runPublishBundle(baseInput({ slug: "site" }), deps);
    if (!v1.ok) throw new Error("unexpected collision");
    const stable = bundleCurrentKey("acct_1", v1.result.entryPageId, "about.html");

    expect(artifacts.filter((a) => a.key === stable)).toHaveLength(1);
    // Same bytes at both keys.
    const hashed = artifacts.find(
      (a) => a.key === v1.result.files[0]!.artifactKey,
    )!;
    expect(artifacts.find((a) => a.key === stable)!.html).toBe(hashed.html);

    const v2 = await runPublishBundle(
      baseInput({
        slug: "site",
        files: [
          { path: "index.html", html: "<p>home v2</p>" },
          { path: "about.html", html: "<p>about v2</p>" },
        ],
      }),
      deps,
    );
    if (!v2.ok) throw new Error("unexpected collision");

    // The SAME key was overwritten — nothing on the serve path is version-coupled,
    // so the sibling republish is live on the next request with no eviction.
    const writes = artifacts.filter((a) => a.key === stable);
    expect(writes).toHaveLength(2);
    expect(writes[1]!.html).toContain("about v2");
    expect(writes[1]!.meta.version).toBe(2);
    // The v2 hashed sibling is written too (history/rollback).
    expect(
      artifacts.some((a) => a.key === v2.result.files[0]!.artifactKey),
    ).toBe(true);
    expect(v2.result.files[0]!.artifactKey).not.toBe(
      v1.result.files[0]!.artifactKey,
    );
  });

  it("#232: a FAILED bundle-version commit leaves no sibling current.html", async () => {
    // Ordering guard, mirroring the single-page one: a sibling's stable object is
    // public the instant it lands, so it must not exist before the bundleVersions
    // row that authorizes it is committed.
    const { deps, artifacts } = makeDeps();
    deps.insertBundleVersion = async () => {
      throw new Error("boom: bundle commit failed");
    };

    await expect(
      runPublishBundle(baseInput({ slug: "site" }), deps),
    ).rejects.toThrow(/bundle commit failed/);

    expect(
      artifacts.some((a) => a.key.startsWith("bundles/") && a.key.endsWith("/current.html")),
    ).toBe(false);
    // The immutable sibling object IS durable — unreferenced, so unreachable.
    expect(
      artifacts.some((a) => a.key.startsWith("bundles/acct_1/")),
    ).toBe(true);
  });

  it("does NOT rewrite links — the sibling's authored relative link is stored verbatim", async () => {
    const { deps, artifacts } = makeDeps();
    const out = await runPublishBundle(baseInput({ slug: "site" }), deps);
    if (!out.ok) throw new Error("unexpected collision");
    const sibling = out.result.files[0]!;
    const art = artifacts.find((a) => a.key === sibling.artifactKey)!;
    // about.html linked to index.html with a bare relative href — kept as-is.
    expect(art.html).toContain('href="index.html"');
    expect(art.html).not.toContain("shortwind.app");
  });

  it("409s when the entry slug is already taken by a page", async () => {
    const { deps, data } = makeDeps();
    // Pre-seed a page occupying the slug.
    await data.insertPage({
      accountId: "acct_1",
      slug: "site",
      visibility: "public",
      tags: [],
    });
    const out = await runPublishBundle(baseInput({ slug: "site" }), deps);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected collision");
    expect(out.collision.status).toBe(409);
  });

  it("derives the slug from the entry path when none is given", async () => {
    const { deps } = makeDeps();
    const out = await runPublishBundle(
      baseInput({ slug: undefined, entryPath: "index.html" }),
      deps,
    );
    if (!out.ok) throw new Error("unexpected collision");
    expect(out.result.bundleId).toBe("index");
    expect(out.result.url).toBe("https://index.shortwind.app");
  });

  it("mints a handle when the entry title is reserved, instead of failing", async () => {
    // Regression: the CLI sends the entry's <title>, so an index.html titled
    // "Docs" (a RESERVED_SLUG) used to throw where the entry PATH had published
    // fine. Only an EXPLICIT slug may fail a publish.
    const { deps } = makeDeps();
    const out = await runPublishBundle(
      baseInput({ slug: undefined, entryPath: "index.html", title: "Docs" }),
      deps,
    );
    if (!out.ok) throw new Error("unexpected collision");
    expect(out.result.url).toMatch(/^https:\/\/page-[a-z0-9]{10}\.shortwind\.app$/);
  });

  it("mints a handle when the entry title slugifies to nothing", async () => {
    const { deps } = makeDeps();
    const out = await runPublishBundle(
      baseInput({ slug: undefined, entryPath: "index.html", title: "!!!" }),
      deps,
    );
    if (!out.ok) throw new Error("unexpected collision");
    expect(out.result.url).toMatch(/^https:\/\/page-[a-z0-9]{10}\.shortwind\.app$/);
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

  it("normalizes nested sibling paths in the stored key", async () => {
    const { deps } = makeDeps();
    const out = await runPublishBundle(
      baseInput({
        slug: "site",
        files: [
          { path: "index.html", html: "<p>home</p>" },
          { path: "docs/./guide.html", html: "<p>guide</p>" },
        ],
      }),
      deps,
    );
    if (!out.ok) throw new Error("unexpected collision");
    expect(out.result.files[0]!.path).toBe(normalizeBundlePath("docs/./guide.html"));
    expect(out.result.files[0]!.path).toBe("docs/guide.html");
  });
});
