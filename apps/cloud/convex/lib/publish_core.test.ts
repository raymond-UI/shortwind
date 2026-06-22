import { describe, expect, it } from "vitest";
import {
  artifactKey,
  assembleArtifact,
  bumpRecipeVersion,
  lockfileVersions,
  resolveRootDomain,
  runPublish,
  runUpdate,
  subdomainUrl,
  type AuditWrite,
  type EdgePort,
  type NewPageVersion,
  type PageRecord,
  type PublishDataPort,
  type PublishDeps,
  type PublishInput,
  type RecipeEditEventWrite,
  type RecipeVersionWrite,
  type StoragePort,
  type StoredRecipeVersion,
} from "./publish_core.js";
import { computeBodySha } from "../../shared/src/fingerprint.js";
import { deriveSubdomain } from "../../shared/src/slug.js";
import type { Lockfile } from "../../shared/src/lockfile-diff.js";

/**
 * CLOUD-23 publish-core tests — drive the PURE `runPublish`/`runUpdate` with
 * in-memory ports (no Convex harness). Covers every acceptance case in the
 * brief: create, idempotent re-publish, update (version bump, same URL, prior
 * retained), recipe-edit-rides-up (versioned + edit event + distinct audit),
 * 409 on slug collision, and a golden assembled-artifact document.
 */

// ---------------------------------------------------------------------------
// In-memory ports.
// ---------------------------------------------------------------------------

interface StoredArtifact {
  key: string;
  html: string;
  meta: Parameters<StoragePort["writeArtifact"]>[2];
}

class MemoryData implements PublishDataPort {
  pages = new Map<string, PageRecord & { visibility: string; tags: string[] }>();
  pageVersions: (NewPageVersion & { id: string })[] = [];
  recipeVersions: (RecipeVersionWrite & { id: string })[] = [];
  recipeEditEvents: RecipeEditEventWrite[] = [];
  audits: AuditWrite[] = [];
  lockfiles = new Map<string, Lockfile>();
  idem = new Map<string, { resultId: string; result: Record<string, unknown> }>();
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async findPageBySlug(accountId: string, slug: string): Promise<PageRecord | null> {
    for (const p of this.pages.values()) {
      if (p.accountId === accountId && p.slug === slug) return p;
    }
    return null;
  }
  async getPage(pageId: string): Promise<PageRecord | null> {
    return this.pages.get(pageId) ?? null;
  }
  // CLOUD-SUBDOMAIN: global (cross-account) subdomain-uniqueness probe.
  async subdomainTaken(label: string): Promise<boolean> {
    for (const p of this.pages.values()) {
      if (p.subdomain === label) return true;
    }
    return false;
  }
  async insertPage(page: {
    accountId: string;
    slug: string;
    visibility: "public" | "unlisted" | "private";
    tags: string[];
  }): Promise<{ id: string; subdomain: string }> {
    // Mirror the real commitNewPage: derive + re-probe the subdomain at insert
    // time (audit #155) so a same-slug second page gets a distinct `slug-<id>`.
    const subdomain = await deriveSubdomain(page.slug, (label) =>
      this.subdomainTaken(label),
    );
    const id = this.id("page");
    this.pages.set(id, {
      id,
      accountId: page.accountId,
      slug: page.slug,
      subdomain,
      currentVersion: 0,
      visibility: page.visibility,
      tags: page.tags,
    });
    return { id, subdomain };
  }
  async patchPageCurrentVersion(
    pageId: string,
    _currentVersionId: string,
    currentVersion: number,
  ): Promise<void> {
    const p = this.pages.get(pageId);
    if (p) p.currentVersion = currentVersion;
  }
  async insertPageVersion(version: NewPageVersion): Promise<string> {
    const id = this.id("ver");
    this.pageVersions.push({ ...version, id });
    return id;
  }
  async latestRecipeVersion(
    accountId: string,
    family: string,
  ): Promise<StoredRecipeVersion | null> {
    const matches = this.recipeVersions.filter(
      (r) => r.accountId === accountId && r.family === family,
    );
    const last = matches.at(-1);
    return last ? { family, version: last.version, bodySha: last.bodySha } : null;
  }
  async insertRecipeVersion(write: RecipeVersionWrite): Promise<string> {
    const id = this.id("rv");
    this.recipeVersions.push({ ...write, id });
    return id;
  }
  async insertRecipeEditEvent(write: RecipeEditEventWrite): Promise<string> {
    this.recipeEditEvents.push(write);
    return this.id("ree");
  }
  async insertAudit(write: AuditWrite): Promise<string> {
    this.audits.push(write);
    return this.id("audit");
  }
  async getStoredLockfile(pageId: string): Promise<Lockfile | null> {
    return this.lockfiles.get(pageId) ?? null;
  }
  async putStoredLockfile(pageId: string, lockfile: Lockfile): Promise<void> {
    this.lockfiles.set(pageId, lockfile);
  }
  async getIdempotency(accountId: string, key: string) {
    return this.idem.get(`${accountId}:${key}`) ?? null;
  }
  async putIdempotency(
    accountId: string,
    key: string,
    resultId: string,
    result: Record<string, unknown>,
  ): Promise<void> {
    this.idem.set(`${accountId}:${key}`, { resultId, result });
  }
}

class MemoryStorage implements StoragePort {
  artifacts: StoredArtifact[] = [];
  async writeArtifact(
    key: string,
    html: string,
    meta: StoredArtifact["meta"],
  ): Promise<void> {
    this.artifacts.push({ key, html, meta });
  }
}

class MemoryEdge implements EdgePort {
  invalidated: string[] = [];
  routes: {
    pageId: string;
    slug: string;
    subdomain: string;
    version: number;
    artifactKey: string;
  }[] = [];
  async invalidate(url: string): Promise<void> {
    this.invalidated.push(url);
  }
  async putRoute(args: {
    pageId: string;
    slug: string;
    subdomain: string;
    version: number;
    artifactKey: string;
  }): Promise<void> {
    this.routes.push(args);
  }
}

function makeDeps() {
  const data = new MemoryData();
  const storage = new MemoryStorage();
  const edge = new MemoryEdge();
  const deps: PublishDeps = {
    data,
    storage,
    edge,
    env: { baseUrl: "https://shortwind.app" },
  };
  return { data, storage, edge, deps };
}

// ---------------------------------------------------------------------------
// Fixtures — sealed recipe sources. A sealed file is `header\nbody`. The header
// records the sha; "touched" means the recorded sha != the body's actual sha.
// ---------------------------------------------------------------------------

const ACCOUNT = "acct_1";
const TOKEN = "tok_1";

const CARD_BODY = "@recipe card {\n  rounded-lg border p-4\n}\n";

/** A sealed file whose header sha MATCHES the body — untouched. */
async function cleanCardSource(): Promise<string> {
  const real = await computeBodySha(`x\n${CARD_BODY}`); // sha is over body-after-header
  return `/* shortwind: card@0.4.0 sha:${real} — DO NOT EDIT THIS LINE */\n${CARD_BODY}`;
}

/** A sealed file whose header sha is STALE (body edited after sealing). */
function touchedCardSource(): string {
  // A deliberately wrong recorded sha (not the placeholder, not the real body sha).
  const staleSha = "deadbeefdeadbeef";
  return `/* shortwind: card@0.4.0 sha:${staleSha} — DO NOT EDIT THIS LINE */\n${CARD_BODY}`;
}

function lockfile(cardVersion = "0.4.0", cardSha = "deadbeefdeadbeef"): Lockfile {
  return {
    version: 1,
    registry: "default",
    families: { card: { version: cardVersion, sha: cardSha } },
  };
}

async function basePublishInput(
  overrides: Partial<PublishInput> = {},
): Promise<PublishInput> {
  return {
    actor: { accountId: ACCOUNT, tokenId: TOKEN },
    html: '<div class="@card">hello</div>',
    slug: "my-status",
    recipes: [{ family: "card", source: await cleanCardSource() }],
    lockfile: lockfile(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("runPublish — create", () => {
  it("returns id/url/version and writes one artifact + page version", async () => {
    const { data, storage, edge, deps } = makeDeps();
    const out = await runPublish(await basePublishInput(), deps);

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.id).toMatch(/^page_/);
    // CLOUD-SUBDOMAIN: the canonical URL is now the per-page subdomain.
    expect(out.result.url).toBe("https://my-status.shortwind.app");
    expect(out.result.version).toBe(1);

    expect(storage.artifacts).toHaveLength(1);
    expect(storage.artifacts[0]!.key).toBe(
      artifactKey(ACCOUNT, out.result.id, storage.artifacts[0]!.meta.expandedHash),
    );
    expect(data.pageVersions).toHaveLength(1);
    expect(data.pageVersions[0]!.version).toBe(1);
    // The stored page points at version 1.
    expect(data.pages.get(out.result.id)!.currentVersion).toBe(1);
    // The lockfile snapshot is persisted for the next diff.
    expect(data.lockfiles.get(out.result.id)).toEqual(lockfile());
    // Edge route registered (carries slug + subdomain) + URL invalidated.
    expect(edge.routes).toHaveLength(1);
    expect(edge.routes[0]!.slug).toBe("my-status");
    expect(edge.routes[0]!.subdomain).toBe("my-status");
    expect(edge.invalidated).toEqual(["https://my-status.shortwind.app"]);
    // A page.publish audit row exists.
    expect(data.audits.some((a) => a.action === "page.publish")).toBe(true);
  });

  it("the served artifact is a complete self-contained Tailwind document", async () => {
    const { storage, deps } = makeDeps();
    await runPublish(await basePublishInput(), deps);
    const html = storage.artifacts[0]!.html;
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@tailwindcss/browser@4");
    expect(html).toContain('<style type="text/tailwindcss">');
    // Expanded Tailwind, not the raw @recipe token.
    expect(html).not.toContain('class="@card"');
    // No live expander runtime — frozen output (PRD §5.6).
    expect(html).not.toContain("expand.js");
  });

  it("derives a slug from the title when no slug is given", async () => {
    const { deps } = makeDeps();
    const input = await basePublishInput({ slug: undefined, title: "My Status Page!" });
    const out = await runPublish(input, deps);
    expect(out.ok && out.result.url).toBe("https://my-status-page.shortwind.app");
  });
});

describe("runPublish — idempotency", () => {
  it("a re-publish with the same key returns the same id and creates no dup", async () => {
    const { data, storage, deps } = makeDeps();
    const input = await basePublishInput({ idempotencyKey: "key-abc" });

    const first = await runPublish(input, deps);
    const second = await runPublish(input, deps);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result).toEqual(first.result);
    // No duplicate page / version / artifact.
    expect(data.pages.size).toBe(1);
    expect(data.pageVersions).toHaveLength(1);
    expect(storage.artifacts).toHaveLength(1);
  });
});

describe("runPublish — slug collision (PRD §3.2)", () => {
  it("returns 409 with the existing id when the slug is taken", async () => {
    const { data, deps } = makeDeps();
    const first = await runPublish(await basePublishInput(), deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // A second, distinct publish (different idempotency, no key) to the same slug.
    const collide = await runPublish(await basePublishInput(), deps);
    expect(collide.ok).toBe(false);
    if (collide.ok) return;
    expect(collide.collision.status).toBe(409);
    expect(collide.collision.existingId).toBe(first.result.id);
    // No second page created.
    expect(data.pages.size).toBe(1);
  });
});

describe("runPublish — recipe edit rides up (PRD §5.4)", () => {
  it("versions the touched body + emits an edit event + a distinct audit row", async () => {
    const { data, deps } = makeDeps();
    const input = await basePublishInput({
      recipes: [{ family: "card", source: touchedCardSource() }],
    });
    const out = await runPublish(input, deps);
    expect(out.ok).toBe(true);

    // New forward-only recipe version (0.4.0 -> 0.5.0).
    expect(data.recipeVersions).toHaveLength(1);
    expect(data.recipeVersions[0]!.family).toBe("card");
    expect(data.recipeVersions[0]!.version).toBe("0.5.0");
    // body is persisted (the part after the seal line).
    expect(data.recipeVersions[0]!.body).toBe(CARD_BODY);

    // A distinct recipeEditEvent.
    expect(data.recipeEditEvents).toHaveLength(1);
    expect(data.recipeEditEvents[0]!).toMatchObject({
      family: "card",
      fromVersion: "0.4.0",
      toVersion: "0.5.0",
      actorTokenId: TOKEN,
    });

    // A DISTINCT recipe.edit audit row, separate from page.publish.
    const recipeAudits = data.audits.filter((a) => a.action === "recipe.edit");
    const pageAudits = data.audits.filter((a) => a.action === "page.publish");
    expect(recipeAudits).toHaveLength(1);
    expect(pageAudits).toHaveLength(1);
    expect(recipeAudits[0]!.targetId).toBe("card");
  });

  it("an untouched recipe creates no recipe version or edit event", async () => {
    const { data, deps } = makeDeps();
    await runPublish(await basePublishInput(), deps); // clean card source
    expect(data.recipeVersions).toHaveLength(0);
    expect(data.recipeEditEvents).toHaveLength(0);
    expect(data.audits.some((a) => a.action === "recipe.edit")).toBe(false);
  });
});

describe("runUpdate — version bump, same URL, prior retained (PRD §5.6)", () => {
  it("bumps the version, keeps the slug/url, retains the prior version row", async () => {
    const { data, storage, edge, deps } = makeDeps();
    const created = await runPublish(await basePublishInput(), deps);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const pageId = created.result.id;

    const updated = await runUpdate(
      {
        actor: { accountId: ACCOUNT, tokenId: TOKEN },
        pageId,
        html: '<div class="@card">hello v2</div>',
        recipes: [{ family: "card", source: await cleanCardSource() }],
        lockfile: lockfile(),
      },
      deps,
    );

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.result.id).toBe(pageId);
    expect(updated.result.version).toBe(2);
    // SAME url.
    expect(updated.result.url).toBe(created.result.url);

    // Prior version row retained — two versions, v1 untouched.
    expect(data.pageVersions).toHaveLength(2);
    expect(data.pageVersions.map((v) => v.version).sort()).toEqual([1, 2]);
    expect(data.pages.get(pageId)!.currentVersion).toBe(2);
    // A fresh artifact written for v2 (distinct content hash).
    expect(storage.artifacts).toHaveLength(2);
    // Edge invalidated the same (subdomain) URL again.
    expect(edge.invalidated).toEqual([
      "https://my-status.shortwind.app",
      "https://my-status.shortwind.app",
    ]);
    expect(data.audits.some((a) => a.action === "page.update")).toBe(true);
  });

  it("only touched recipes ride up on update (clean body → no recipe write)", async () => {
    const { data, deps } = makeDeps();
    const created = await runPublish(await basePublishInput(), deps);
    if (!created.ok) return;
    await runUpdate(
      {
        actor: { accountId: ACCOUNT, tokenId: TOKEN },
        pageId: created.result.id,
        html: '<div class="@card">v2</div>',
        recipes: [{ family: "card", source: await cleanCardSource() }],
        lockfile: lockfile(),
      },
      deps,
    );
    expect(data.recipeVersions).toHaveLength(0);
  });
});

describe("CLOUD-SUBDOMAIN — per-page subdomain serving", () => {
  it("a free slug gets the bare <slug> as its globally-unique subdomain", async () => {
    const { data, deps } = makeDeps();
    const out = await runPublish(await basePublishInput(), deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // The page stores the bare slug as its subdomain.
    expect(data.pages.get(out.result.id)!.subdomain).toBe("my-status");
    // The published URL is https://<slug>.shortwind.app.
    expect(out.result.url).toBe("https://my-status.shortwind.app");
  });

  it("a same-slug publish from a DIFFERENT account gets <slug>-<id> (no collision)", async () => {
    const { data, deps } = makeDeps();
    // First account takes the bare label.
    const first = await runPublish(await basePublishInput(), deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(data.pages.get(first.result.id)!.subdomain).toBe("my-status");

    // A second account publishes the SAME slug — slug-collision is per-account, so
    // this is a NEW page, but the subdomain is global so it must disambiguate.
    const second = await runPublish(
      await basePublishInput({ actor: { accountId: "acct_2", tokenId: "tok_2" } }),
      deps,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const label = data.pages.get(second.result.id)!.subdomain!;
    // Disambiguated: my-status-<id>, NOT the bare label, and globally unique.
    expect(label).toMatch(/^my-status-[a-z0-9]+$/);
    expect(label).not.toBe("my-status");
    expect(second.result.url).toBe(`https://${label}.shortwind.app`);
  });

  it("avoids a reserved system label even when the slug is free", async () => {
    const { data, deps } = makeDeps();
    // A page whose slug would be the reserved system label `cloud` must NOT take
    // the bare `cloud` subdomain (that would shadow a system host).
    const out = await runPublish(
      await basePublishInput({ slug: "cloud" }),
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const label = data.pages.get(out.result.id)!.subdomain!;
    expect(label).not.toBe("cloud");
    expect(label).toMatch(/^cloud-[a-z0-9]+$/);
  });

  it("update keeps the SAME subdomain (stable once minted)", async () => {
    const { data, deps } = makeDeps();
    const created = await runPublish(await basePublishInput(), deps);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const pageId = created.result.id;
    const original = data.pages.get(pageId)!.subdomain;

    const updated = await runUpdate(
      {
        actor: { accountId: ACCOUNT, tokenId: TOKEN },
        pageId,
        html: '<div class="@card">v2</div>',
        recipes: [{ family: "card", source: await cleanCardSource() }],
        lockfile: lockfile(),
      },
      deps,
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    // Same subdomain, same URL.
    expect(data.pages.get(pageId)!.subdomain).toBe(original);
    expect(updated.result.url).toBe(created.result.url);
    expect(updated.result.url).toBe("https://my-status.shortwind.app");
  });
});

describe("CLOUD-SUBDOMAIN — URL helpers", () => {
  it("resolveRootDomain derives the apex from the base URL host", () => {
    expect(resolveRootDomain({ baseUrl: "https://c.shortwind.dev" })).toBe(
      "shortwind.dev",
    );
    expect(resolveRootDomain({ baseUrl: "https://shortwind.app" })).toBe(
      "shortwind.app",
    );
    // An explicit rootDomain overrides the derivation.
    expect(
      resolveRootDomain({ baseUrl: "https://c.shortwind.dev", rootDomain: "x.io" }),
    ).toBe("x.io");
  });

  it("subdomainUrl builds https://<subdomain>.<root>", () => {
    expect(subdomainUrl("shortwind.dev", "cloud-ops")).toBe(
      "https://cloud-ops.shortwind.dev",
    );
  });
});

describe("pure helpers", () => {
  it("artifactKey matches the worker/src/r2.ts convention", () => {
    expect(artifactKey("a", "p", "abc123")).toBe("artifacts/a/p/abc123.html");
  });

  it("bumpRecipeVersion bumps minor and seeds first version", () => {
    expect(bumpRecipeVersion("0.4.0")).toBe("0.5.0");
    expect(bumpRecipeVersion(null)).toBe("0.1.0");
    expect(bumpRecipeVersion("not-semver")).toBe("0.1.0");
  });

  it("lockfileVersions flattens to a sorted family→version map", () => {
    const lf: Lockfile = {
      version: 1,
      registry: "default",
      families: {
        btn: { version: "1.0.0", sha: "aa" },
        card: { version: "0.4.0", sha: "bb" },
      },
    };
    expect(lockfileVersions(lf)).toEqual({ btn: "1.0.0", card: "0.4.0" });
  });

  it("assembleArtifact returns a FULL document verbatim (no wrap, no browser script)", () => {
    const fullDoc = [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      "<title>Standalone</title>",
      '<link href="https://fonts.googleapis.com/css2?family=Fraunces" rel="stylesheet">',
      "<style>:root{--background:hsl(15 55% 96.5%)}</style>",
      "</head>",
      '<body><h1 class="hero">Hello</h1></body>',
      "</html>",
    ].join("\n");
    // A complete document is returned byte-identical — no wrapper injected.
    expect(assembleArtifact(fullDoc, '@import "tailwindcss";')).toBe(fullDoc);
    // Verbatim: exactly one <html>, and the browser compiler is NOT injected.
    const out = assembleArtifact(fullDoc, '@import "tailwindcss";');
    expect(out.match(/<html/gi)).toHaveLength(1);
    expect(out).not.toContain("@tailwindcss/browser");
    // Leading whitespace before the doctype is tolerated (still passthrough).
    expect(assembleArtifact(`\n  ${fullDoc}`, "x")).toBe(`\n  ${fullDoc}`);
    // A bare <html> (no doctype) also passes through verbatim.
    const htmlOnly = "<html><body>hi</body></html>";
    expect(assembleArtifact(htmlOnly, "x")).toBe(htmlOnly);
  });

  it("assembleArtifact WRAPS a fragment (injects the tailwindcss browser compiler)", () => {
    const fragment = '<div class="rounded-lg border p-4">hi</div>';
    const out = assembleArtifact(fragment, '@import "tailwindcss";');
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("@tailwindcss/browser@4");
    expect(out).toContain('<style type="text/tailwindcss">');
    expect(out).toContain(fragment);
  });

  it("assembleArtifact is a stable, self-contained golden document", () => {
    const doc = assembleArtifact(
      '<div class="rounded-lg border p-4">hi</div>',
      '@import "tailwindcss";',
    );
    expect(doc).toBe(
      [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>',
        '<style type="text/tailwindcss">',
        '@import "tailwindcss";',
        "</style>",
        "</head>",
        "<body>",
        '<div class="rounded-lg border p-4">hi</div>',
        "</body>",
        "</html>",
        "",
      ].join("\n"),
    );
  });
});
