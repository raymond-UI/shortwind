import { describe, expect, it } from "vitest";
import {
  deriveSlug,
  MAX_SLUG_LENGTH,
  RESERVED_SLUGS,
  slugCollision,
  validateSlug,
} from "./slug.js";

describe("deriveSlug (CLOUD-03)", () => {
  it("lowercases, trims, and hyphenates whitespace/underscores", () => {
    expect(deriveSlug("  My Cool Page  ")).toEqual({ ok: true, value: "my-cool-page" });
    expect(deriveSlug("snake_case_name")).toEqual({ ok: true, value: "snake-case-name" });
  });

  it("strips reserved characters and collapses runs of separators", () => {
    expect(deriveSlug("Hello, World! (v2)")).toEqual({ ok: true, value: "hello-world-v2" });
    expect(deriveSlug("a///b___c   d")).toEqual({ ok: true, value: "a-b-c-d" });
  });

  it("trims leading/trailing hyphens produced by stripping", () => {
    expect(deriveSlug("--edge--")).toEqual({ ok: true, value: "edge" });
    expect(deriveSlug("...weird...")).toEqual({ ok: true, value: "weird" });
  });

  it("truncates to the max length without leaving a trailing hyphen", () => {
    const long = "a".repeat(MAX_SLUG_LENGTH + 20);
    const derived = deriveSlug(long);
    expect(derived.ok).toBe(true);
    if (derived.ok) {
      expect(derived.value.length).toBe(MAX_SLUG_LENGTH);
      expect(derived.value.endsWith("-")).toBe(false);
    }
  });

  it("fails when nothing slug-able remains", () => {
    const r = deriveSlug("!!!___!!!");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty|no usable/i);
  });

  it("preserves digits and existing valid slugs unchanged", () => {
    expect(deriveSlug("already-valid-123")).toEqual({ ok: true, value: "already-valid-123" });
  });
});

describe("validateSlug (CLOUD-03)", () => {
  it("accepts a canonical slug", () => {
    expect(validateSlug("my-cool-page")).toEqual({ ok: true, value: "my-cool-page" });
  });

  it("rejects uppercase, spaces, and reserved punctuation", () => {
    expect(validateSlug("My-Page").ok).toBe(false);
    expect(validateSlug("my page").ok).toBe(false);
    expect(validateSlug("my/page").ok).toBe(false);
    expect(validateSlug("my.page").ok).toBe(false);
  });

  it("rejects leading/trailing/double hyphens", () => {
    expect(validateSlug("-page").ok).toBe(false);
    expect(validateSlug("page-").ok).toBe(false);
    expect(validateSlug("a--b").ok).toBe(false);
  });

  it("rejects the empty slug and over-length slugs", () => {
    expect(validateSlug("").ok).toBe(false);
    expect(validateSlug("a".repeat(MAX_SLUG_LENGTH + 1)).ok).toBe(false);
  });

  it("accepts a slug exactly at the max length", () => {
    expect(validateSlug("a".repeat(MAX_SLUG_LENGTH)).ok).toBe(true);
  });

  it("rejects reserved route slugs (api, admin, ...)", () => {
    for (const reserved of RESERVED_SLUGS) {
      const r = validateSlug(reserved);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/reserved/i);
    }
  });
});

describe("slugCollision -> idempotent-publish 409 signal (PRD 3.2)", () => {
  it("signals a collision with the existing page id when the slug is taken", () => {
    const signal = slugCollision("landing", { id: "pg_123", slug: "landing" });
    expect(signal).toEqual({ collision: true, status: 409, existingId: "pg_123" });
  });

  it("reports no collision when the slug is free", () => {
    expect(slugCollision("landing", null)).toEqual({ collision: false });
  });

  it("is keyed on the exact slug (different slug -> no collision)", () => {
    expect(slugCollision("landing", { id: "pg_123", slug: "other" })).toEqual({
      collision: false,
    });
  });
});
