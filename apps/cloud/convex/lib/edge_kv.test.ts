import { describe, expect, it } from "vitest";
import {
  routeKey,
  routeKeyForSubdomain,
  routeKeyForSubdomainPath,
} from "./edge_kv.js";

/**
 * CLOUD-SUBDOMAIN — the kill-path KV eviction key derivation.
 *
 * The serve Worker (worker/src/kv.ts) keys a route on `route:{host}{path}` (host
 * lowercased, path leading-slash-normalized). The Convex kill/delete/expiry paths
 * RE-DERIVE that key here (Convex never imports the Worker — CLAUDE.md), so a kill
 * evicts the SAME key the serve hot path wrote.
 *
 * Serving is SUBDOMAIN-ONLY: the legacy path-based key (`route:{serveHost}/{slug}`)
 * was retired, so the ONLY key in play is the per-page subdomain key
 * (`route:{subdomain}.{root}/`). These tests pin the derived key to the EXACT byte
 * form `worker/src/kv.ts` `routeKey(host, path)` produces (asserted there against
 * the same literals).
 *
 * worker/src/kv.ts is NOT imported here (it types against @cloudflare/workers-types
 * via ./env, which the Convex tsconfig does not load); the literal byte form is
 * the contract and is mirrored in worker/test/router.test.ts.
 */

describe("edge_kv routeKey matches the worker/src/kv.ts byte form", () => {
  it("the per-page subdomain serve key (host=<subdomain>.<root>, path=/)", () => {
    expect(routeKeyForSubdomain("cloud-ops", "shortwind.dev")).toBe(
      "route:cloud-ops.shortwind.dev/",
    );
  });

  it("lowercases the host (DNS labels are case-insensitive)", () => {
    expect(routeKeyForSubdomain("Cloud-Ops", "Shortwind.Dev")).toBe(
      "route:cloud-ops.shortwind.dev/",
    );
  });

  it("routeKey normalizes a path with no leading slash", () => {
    expect(routeKey("Foo.Bar", "baz")).toBe("route:foo.bar/baz");
  });

  // #232 — a BUNDLE serves many URLs through ONE page: each sibling caches under
  // its own route key, so a lifecycle/visibility eviction has to derive one key
  // per sibling path. `bundleVersions.files[].path` is stored WITHOUT a leading
  // slash, and the Worker keys the request path WITH one, so the normalization
  // is what makes the two ends meet.
  it("derives a sibling's route key from its stored (slash-less) bundle path", () => {
    expect(
      routeKeyForSubdomainPath("cloud-ops", "about.html", "shortwind.dev"),
    ).toBe("route:cloud-ops.shortwind.dev/about.html");
    expect(
      routeKeyForSubdomainPath("cloud-ops", "docs/guide.html", "shortwind.dev"),
    ).toBe("route:cloud-ops.shortwind.dev/docs/guide.html");
  });

  it("a sibling path that already has a leading slash keys identically", () => {
    expect(
      routeKeyForSubdomainPath("cloud-ops", "/about.html", "shortwind.dev"),
    ).toBe(routeKeyForSubdomainPath("cloud-ops", "about.html", "shortwind.dev"));
  });

  it("the entry key is the same derivation at path `/`", () => {
    expect(routeKeyForSubdomainPath("cloud-ops", "/", "shortwind.dev")).toBe(
      routeKeyForSubdomain("cloud-ops", "shortwind.dev"),
    );
  });
});
