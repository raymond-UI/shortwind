import { describe, expect, it } from "vitest";
import { assembleUpdatePayload, runUpdate } from "./update.js";
import { computeBodySha } from "../../../shared/src/fingerprint.js";
import type { CandidateRecipe } from "../../../shared/src/fingerprint.js";
import type { ApiClient } from "../api-client.js";
import type { Lockfile } from "../../../shared/src/lockfile-diff.js";

/**
 * update handler tests — same touched-bodies-only assembly as publish, but the
 * PATCH body carries NO slug (the URL is fixed to the target id; PRD §5.6).
 */

const LOCKFILE: Lockfile = { version: 1, registry: "default", families: {} };

async function sealedUntouched(family: string, body: string): Promise<string> {
  const sha = await computeBodySha(`/* placeholder */\n${body}`);
  return `/* shortwind: ${family}@1.0.0 sha:${sha} */\n${body}`;
}

function sealedTouched(family: string, body: string): string {
  return `/* shortwind: ${family}@1.0.0 sha:0000000000000000 */\n${body}`;
}

describe("assembleUpdatePayload", () => {
  it("carries only touched bodies and never a slug", async () => {
    const candidates: CandidateRecipe[] = [
      { family: "card", source: sealedTouched("card", "@recipe card { base: p-4; }\n") },
      { family: "button", source: await sealedUntouched("button", "@recipe button {}\n") },
    ];
    const payload = await assembleUpdatePayload({
      html: "<h1>v2</h1>",
      lockfile: LOCKFILE,
      candidates,
      tags: ["ops"],
      visibility: "private",
      idempotencyKey: "key-2",
    });
    expect(payload.recipes.map((r) => r.family)).toEqual(["card"]);
    expect(payload.html).toBe("<h1>v2</h1>");
    expect(payload.tags).toEqual(["ops"]);
    expect(payload.visibility).toBe("private");
    expect(payload.idempotencyKey).toBe("key-2");
    expect("slug" in (payload as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe("runUpdate", () => {
  it("PATCHes the given id and renders the bumped version", async () => {
    let seen: { id?: string } = {};
    const client: ApiClient = {
      findPages: async () => ({ pages: [] }),
      getPage: async () => {
        throw new Error("unused");
      },
      publishPage: async () => {
        throw new Error("unused");
      },
      updatePage: async (id) => {
        seen.id = id;
        return { id, url: "https://shortwind.dev/x", version: 5 };
      },
    };
    const payload = await assembleUpdatePayload({ html: "x", lockfile: LOCKFILE, candidates: [] });
    const { output, result } = await runUpdate(client, "pg_7", payload, false);
    expect(seen.id).toBe("pg_7");
    expect(result.version).toBe(5);
    expect(output).toContain("version: v5");
  });
});
