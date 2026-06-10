import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSource, BUNDLED_ORIGIN } from "../src/registry-source.js";

describe("resolveSource default — npm-first with bundle fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to the embedded bundle when the network is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const src = await resolveSource(undefined);
    expect(src.origin).toBe(BUNDLED_ORIGIN);
    // still fully functional offline
    expect(await src.listAllFamilies()).toContain("surface");
  });

  it("uses jsDelivr at the latest published catalog version when online", async () => {
    const presets = JSON.stringify({ starter: ["card"], all: "*" });
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("registry.npmjs.org")) {
        return new Response(JSON.stringify({ "dist-tags": { latest: "0.1.0-beta.9" } }), {
          status: 200,
        });
      }
      if (url.includes("cdn.jsdelivr.net") && url.endsWith("/presets.json")) {
        return new Response(presets, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const src = await resolveSource(undefined);
    expect(src.origin).toContain("cdn.jsdelivr.net/npm/@shortwind/catalog@0.1.0-beta.9");
    expect(src.origin).toContain("/dist/registry");
  });

  it("falls back to the bundle when npm has no published catalog version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ "dist-tags": {} }), { status: 200 })),
    );
    const src = await resolveSource(undefined);
    expect(src.origin).toBe(BUNDLED_ORIGIN);
  });

  it("still routes explicit http/file origins to a custom registry source", async () => {
    const httpSrc = await resolveSource("https://corp.example.com/registry");
    expect(httpSrc.origin).toBe("https://corp.example.com/registry");
  });
});
