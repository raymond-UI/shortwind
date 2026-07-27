import { describe, expect, it } from "vitest";
import { bundleCurrentKey, currentArtifactKey } from "./artifact_keys.js";

/**
 * #232 — golden byte form of the STABLE serve keys.
 *
 * These strings are a CROSS-TREE CONTRACT: Convex writes the object, the Worker
 * reads it, and neither may import the other (CLAUDE.md). They now share this one
 * definition, so drift is impossible — but the literals are still pinned here
 * because changing them silently orphans every object already in the bucket
 * (every page would fall through to its migration fallback, and the ones without
 * one would 404).
 */
describe("stable artifact keys", () => {
  it("a page's key is namespaced by account + page", () => {
    expect(currentArtifactKey("acct_123", "page_abc")).toBe(
      "artifacts/acct_123/page_abc/current.html",
    );
  });

  it("a bundle sibling's key is namespaced by account + entry page + path", () => {
    expect(bundleCurrentKey("acct_123", "page_abc", "about.html")).toBe(
      "bundles/acct_123/page_abc/about.html/current.html",
    );
  });

  it("a nested sibling path keeps its directories", () => {
    expect(bundleCurrentKey("acct_123", "page_abc", "docs/guide.html")).toBe(
      "bundles/acct_123/page_abc/docs/guide.html/current.html",
    );
  });

  it("a sibling can never collide with its entry page's key", () => {
    // Different prefixes (`bundles/` vs `artifacts/`) — an entry and a sibling
    // named after it are distinct objects.
    expect(bundleCurrentKey("a", "p", "index.html")).not.toBe(
      currentArtifactKey("a", "p"),
    );
  });
});
