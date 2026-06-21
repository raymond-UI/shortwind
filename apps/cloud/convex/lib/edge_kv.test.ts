import { describe, expect, it } from "vitest";
import {
  routeKey,
  routeKeyForSlug,
  routeKeyForSubdomain,
} from "./edge_kv.js";

/**
 * CLOUD-SUBDOMAIN — the kill-path KV eviction key derivation.
 *
 * The serve Worker (worker/src/kv.ts) keys a route on `route:{host}{path}` (host
 * lowercased, path leading-slash-normalized). The Convex kill/delete/expiry paths
 * RE-DERIVE that key here (Convex never imports the Worker — CLAUDE.md), so a kill
 * evicts the SAME key the serve hot path wrote.
 *
 * These tests pin the derived keys to the EXACT byte form `worker/src/kv.ts`
 * `routeKey(host, path)` produces (asserted there against the same literals):
 *   - the path-based key (`route:{serveHost}/{slug}`) — backward-compat, and
 *   - the per-page subdomain key (`route:{subdomain}.{root}/`) — the new serve.
 *
 * worker/src/kv.ts is NOT imported here (it types against @cloudflare/workers-types
 * via ./env, which the Convex tsconfig does not load); the literal byte form is
 * the contract and is mirrored in worker/test/router.test.ts.
 */

describe("edge_kv routeKey matches the worker/src/kv.ts byte form", () => {
  it("the path-based serve key", () => {
    expect(routeKeyForSlug("cloud-ops", "c.shortwind.dev")).toBe(
      "route:c.shortwind.dev/cloud-ops",
    );
  });

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
});
