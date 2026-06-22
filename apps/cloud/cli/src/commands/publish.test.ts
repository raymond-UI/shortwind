import { describe, expect, it } from "vitest";
import {
  assemblePublishPayload,
  normalizeVisibility,
  renderConflict,
  renderPublishResult,
  runPublish,
} from "./publish.js";
import { ApiError, type ApiClient } from "../api-client.js";
import { computeBodySha } from "../../../shared/src/fingerprint.js";
import type { CandidateRecipe } from "../../../shared/src/fingerprint.js";
import type { Lockfile } from "../../../shared/src/lockfile-diff.js";

/**
 * publish handler tests — assemble + render against a MOCKED api-client, no
 * network. The load-bearing assertion (PRD §5.3): publish sends ONLY the
 * touched recipe BODIES, never the whole palette.
 */

const LOCKFILE: Lockfile = {
  version: 1,
  registry: "default",
  families: { card: { version: "1.0.0", sha: "deadbeef" } },
};

/** Build a sealed recipe source whose header sha matches its body (UNTOUCHED). */
async function sealedUntouched(family: string, body: string): Promise<string> {
  // Compute the body sha over a header+body source; the header line is stripped
  // before hashing, so prepend a placeholder header, hash, then re-seal.
  const probe = `/* placeholder */\n${body}`;
  const sha = await computeBodySha(probe);
  return `/* shortwind: ${family}@1.0.0 sha:${sha} */\n${body}`;
}

/** Build a sealed recipe source whose header sha is STALE (TOUCHED). */
function sealedTouched(family: string, body: string): string {
  return `/* shortwind: ${family}@1.0.0 sha:0000000000000000 */\n${body}`;
}

describe("normalizeVisibility", () => {
  it("accepts the three levels and rejects anything else", () => {
    expect(normalizeVisibility(undefined)).toBeUndefined();
    expect(normalizeVisibility("public")).toBe("public");
    expect(normalizeVisibility("unlisted")).toBe("unlisted");
    expect(normalizeVisibility("private")).toBe("private");
    expect(() => normalizeVisibility("secret")).toThrow(/invalid --visibility/);
  });
});

describe("assemblePublishPayload — touched bodies only", () => {
  it("sends ONLY the touched recipe body, not the whole palette", async () => {
    const touchedBody = "@recipe card {\n  base: rounded-lg border p-4;\n}\n";
    const untouchedBody = "@recipe button {\n  base: inline-flex px-3;\n}\n";
    const candidates: CandidateRecipe[] = [
      { family: "card", source: sealedTouched("card", touchedBody) },
      { family: "button", source: await sealedUntouched("button", untouchedBody) },
    ];

    const payload = await assemblePublishPayload({
      html: "<h1>hi</h1>",
      lockfile: LOCKFILE,
      candidates,
      domain: "status",
      tags: ["ops"],
      visibility: "unlisted",
      idempotencyKey: "key-1",
    });

    // The whole palette has two families; only "card" diverged from its seal.
    expect(payload.recipes).toHaveLength(1);
    expect(payload.recipes[0]!.family).toBe("card");
    expect(payload.recipes[0]!.source).toContain("rounded-lg");
    expect(payload.recipes.map((r) => r.family)).not.toContain("button");

    expect(payload.html).toBe("<h1>hi</h1>");
    expect(payload.lockfile).toEqual(LOCKFILE);
    expect(payload.slug).toBe("status");
    expect(payload.tags).toEqual(["ops"]);
    expect(payload.visibility).toBe("unlisted");
    expect(payload.idempotencyKey).toBe("key-1");
  });

  it("sends an empty recipes array when nothing diverged", async () => {
    const candidates: CandidateRecipe[] = [
      { family: "button", source: await sealedUntouched("button", "@recipe button {}\n") },
    ];
    const payload = await assemblePublishPayload({
      html: "<p/>",
      lockfile: LOCKFILE,
      candidates,
    });
    expect(payload.recipes).toEqual([]);
    expect(payload.slug).toBeUndefined();
    expect(payload.tags).toBeUndefined();
    expect(payload.visibility).toBeUndefined();
  });
});

describe("renderPublishResult / renderConflict — golden output", () => {
  it("renders a success line (human)", () => {
    expect(
      renderPublishResult({ id: "pg_1", url: "https://shortwind.dev/status", version: 2 }, false),
    ).toBe(
      ["published https://shortwind.dev/status", "id:      pg_1", "version: v2"].join("\n"),
    );
  });

  it("renders --json verbatim (stable shape)", () => {
    expect(
      renderPublishResult({ id: "pg_1", url: "https://shortwind.dev/status", version: 2 }, true),
    ).toBe('{\n  "id": "pg_1",\n  "url": "https://shortwind.dev/status",\n  "version": 2\n}');
  });

  it("renders the 409 conflict with the existing id + update hint", () => {
    expect(renderConflict("pg_dup", false)).toBe(
      [
        "a page with this handle already exists (id: pg_dup)",
        "run: shortwind-cloud update pg_dup <file>",
      ].join("\n"),
    );
  });

  it("renders the 409 conflict as --json", () => {
    expect(renderConflict("pg_dup", true)).toBe(
      '{\n  "error": {\n    "code": "CONFLICT",\n    "existingId": "pg_dup"\n  }\n}',
    );
  });
});

describe("runPublish — against a mocked client", () => {
  const okPayload = { html: "x", lockfile: LOCKFILE, recipes: [] };

  it("returns ok + the success output on a 2xx", async () => {
    const client: ApiClient = {
      findPages: async () => ({ pages: [] }),
      getPage: async () => {
        throw new Error("unused");
      },
      publishPage: async () => ({ id: "pg_1", url: "https://shortwind.dev/x", version: 1 }),
      updatePage: async () => {
        throw new Error("unused");
      },
    };
    const run = await runPublish(client, okPayload, false);
    expect(run.ok).toBe(true);
    expect(run.id).toBe("pg_1");
    expect(run.output).toContain("published https://shortwind.dev/x");
  });

  it("turns a 409 into a graceful conflict run with the update hint", async () => {
    const client: ApiClient = {
      findPages: async () => ({ pages: [] }),
      getPage: async () => {
        throw new Error("unused");
      },
      publishPage: async () => {
        throw new ApiError({ kind: "conflict", status: 409, message: "taken", existingId: "pg_dup" });
      },
      updatePage: async () => {
        throw new Error("unused");
      },
    };
    const run = await runPublish(client, okPayload, false);
    expect(run.ok).toBe(false);
    expect(run.id).toBe("pg_dup");
    expect(run.output).toContain("shortwind-cloud update pg_dup");
  });

  it("propagates non-conflict ApiErrors (e.g. 401)", async () => {
    const client: ApiClient = {
      findPages: async () => ({ pages: [] }),
      getPage: async () => {
        throw new Error("unused");
      },
      publishPage: async () => {
        throw new ApiError({ kind: "unauthorized", status: 401, message: "no token" });
      },
      updatePage: async () => {
        throw new Error("unused");
      },
    };
    await expect(runPublish(client, okPayload, false)).rejects.toMatchObject({ kind: "unauthorized" });
  });
});
