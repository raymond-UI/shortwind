import { describe, expect, it, vi } from "vitest";
import {
  assembleBundlePayload,
  renderBundleResult,
  runBundle,
  type BundleCapableClient,
} from "./publish.js";
import type { BundlePayload, BundleResult } from "../api-client.js";
import { computeBodySha } from "../contract/fingerprint.js";
import type { CandidateRecipe } from "../contract/fingerprint.js";
import type { Lockfile } from "../contract/lockfile-diff.js";

/**
 * CLOUD-50 `publish --bundle` handler tests — assemble + render + run against a
 * MOCKED api-client (no network). Proves: the bundle payload carries the entry
 * point + all linked files (entry first); only the touched recipe BODIES ride
 * along; the run drives `publishBundle`.
 */

const LOCKFILE: Lockfile = {
  version: 1,
  registry: "default",
  families: { card: { version: "1.0.0", sha: "deadbeef" } },
};

async function sealedUntouched(family: string, body: string): Promise<string> {
  const probe = `/* placeholder */\n${body}`;
  const sha = await computeBodySha(probe);
  return `/* shortwind: ${family}@1.0.0 sha:${sha} */\n${body}`;
}
function sealedTouched(family: string, body: string): string {
  return `/* shortwind: ${family}@1.0.0 sha:0000000000000000 */\n${body}`;
}

describe("assembleBundlePayload", () => {
  it("ships the entry + linked files (entry first) and ONLY touched recipe bodies", async () => {
    const candidates: CandidateRecipe[] = [
      { family: "card", source: sealedTouched("card", "@recipe card {\n  p-4\n}\n") },
      {
        family: "button",
        source: await sealedUntouched("button", "@recipe button {\n  px-3\n}\n"),
      },
    ];
    const payload = await assembleBundlePayload({
      files: [
        { path: "about.html", html: "<p>about</p>" },
        { path: "index.html", html: '<a href="./about.html">about</a>' },
        { path: "docs/guide.html", html: "<p>guide</p>" },
      ],
      entryPath: "index.html",
      lockfile: LOCKFILE,
      candidates,
      domain: "handbook",
    });

    // entry first, then the rest sorted by path.
    expect(payload.files.map((f) => f.path)).toEqual([
      "index.html",
      "about.html",
      "docs/guide.html",
    ]);
    expect(payload.entryPath).toBe("index.html");
    expect(payload.slug).toBe("handbook");
    expect(payload.lockfile).toEqual(LOCKFILE);

    // only the TOUCHED family's body rode along (not the whole palette).
    expect(payload.recipes.map((r) => r.family)).toEqual(["card"]);
  });

  it("throws when the entry path is not one of the files", async () => {
    await expect(
      assembleBundlePayload({
        files: [{ path: "index.html", html: "<p/>" }],
        entryPath: "missing.html",
        lockfile: LOCKFILE,
        candidates: [],
      }),
    ).rejects.toThrow(/entry "missing.html" is not one of the bundle files/);
  });

  it("throws on an empty bundle", async () => {
    await expect(
      assembleBundlePayload({
        files: [],
        entryPath: "index.html",
        lockfile: LOCKFILE,
        candidates: [],
      }),
    ).rejects.toThrow(/no files/);
  });
});

describe("runBundle", () => {
  it("drives publishBundle and renders the served files", async () => {
    const result: BundleResult = {
      bundleId: "handbook",
      url: "https://shortwind.app/handbook",
      version: 1,
      files: [
        { path: "index.html", artifactKey: "k1", sourceHash: "h1", entry: true },
        { path: "about.html", artifactKey: "k2", sourceHash: "h2", entry: false },
      ],
    };
    const publishBundle = vi.fn(async (_p: BundlePayload) => result);
    const client = { publishBundle } as unknown as BundleCapableClient;

    const payload: BundlePayload = {
      files: [
        { path: "index.html", html: "<p>i</p>" },
        { path: "about.html", html: "<p>a</p>" },
      ],
      entryPath: "index.html",
      recipes: [],
      lockfile: LOCKFILE,
      slug: "handbook",
    };
    const run = await runBundle(client, payload, false);

    expect(publishBundle).toHaveBeenCalledOnce();
    expect(publishBundle).toHaveBeenCalledWith(payload);
    expect(run.ok).toBe(true);
    expect(run.id).toBe("handbook");
    expect(run.output).toContain("published bundle https://shortwind.app/handbook");
    expect(run.output).toContain("files:   2");
    expect(run.output).toContain("→ index.html");
  });

  it("emits the raw result with --json", () => {
    const result: BundleResult = {
      bundleId: "h",
      url: "u",
      version: 3,
      files: [],
    };
    const out = renderBundleResult(result, true);
    expect(JSON.parse(out)).toEqual(result);
  });
});
