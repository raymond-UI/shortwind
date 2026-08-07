import { describe, expect, it, vi } from "vitest";
import {
  deriveSlug,
  htmlTitle,
  deriveSubdomain,
  isReservedSubdomain,
  MAX_SLUG_LENGTH,
  mintSubdomainId,
  RESERVED_SLUGS,
  RESERVED_SUBDOMAINS,
  slugCollision,
  validateHostname,
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

  it("rejects input that derives to a reserved word (audit #158)", () => {
    const r = deriveSlug("API");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reserved/i);
  });

  it("returns {ok:false} (not a throw) for non-string input (audit #158)", () => {
    // @ts-expect-error — exercising the runtime guard against bad callers.
    expect(deriveSlug(undefined).ok).toBe(false);
    // @ts-expect-error
    expect(deriveSlug(42).ok).toBe(false);
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

describe("CLOUD-SUBDOMAIN — reserved subdomain labels", () => {
  it("flags the platform/system labels as reserved", () => {
    for (const label of RESERVED_SUBDOMAINS) {
      expect(isReservedSubdomain(label)).toBe(true);
    }
    expect(isReservedSubdomain("c")).toBe(true);
    expect(isReservedSubdomain("CLOUD")).toBe(true); // case-insensitive
  });

  it("does not flag an ordinary page label", () => {
    expect(isReservedSubdomain("cloud-ops")).toBe(false);
    expect(isReservedSubdomain("my-status")).toBe(false);
  });
});

describe("mintSubdomainId — entropy source", () => {
  it("honours an explicit length (the whole-handle case asks for a long one)", () => {
    expect(mintSubdomainId(10)).toMatch(/^[a-z0-9]{10}$/);
  });

  it("defaults to WebCrypto, not Math.random", () => {
    // A minted id can BE the whole URL of an unlisted page, so it must not come
    // from a source that is recoverable from a few observed outputs.
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    const random = vi.spyOn(Math, "random");
    try {
      expect(mintSubdomainId()).toMatch(/^[a-z0-9]{6}$/);
      expect(spy).toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      random.mockRestore();
    }
  });
});

describe("CLOUD-SUBDOMAIN — mintSubdomainId", () => {
  it("produces a lowercase DNS-label-safe id of the requested length", () => {
    const id = mintSubdomainId(6, () => 0.5);
    expect(id).toMatch(/^[a-z0-9]{6}$/);
  });
});

describe("CLOUD-SUBDOMAIN — deriveSubdomain (the Vercel hybrid)", () => {
  it("returns the bare slug when it is globally free and not reserved", async () => {
    const label = await deriveSubdomain("my-status", async () => false);
    expect(label).toBe("my-status");
  });

  it("disambiguates with <slug>-<id> when the bare label is taken", async () => {
    const taken = new Set(["my-status"]);
    const label = await deriveSubdomain(
      "my-status",
      async (l) => taken.has(l),
      () => "abc123",
    );
    expect(label).toBe("my-status-abc123");
  });

  it("never returns a reserved label even when it is free", async () => {
    const label = await deriveSubdomain("cloud", async () => false, () => "abc123");
    expect(label).toBe("cloud-abc123");
  });

  it("re-mints the id until the disambiguated label is free", async () => {
    const taken = new Set(["my-status", "my-status-aaa"]);
    const ids = ["aaa", "bbb"];
    let i = 0;
    const label = await deriveSubdomain(
      "my-status",
      async (l) => taken.has(l),
      () => ids[i++] ?? "zzz",
    );
    expect(label).toBe("my-status-bbb");
  });
});

describe("validateHostname (#156 — bind-domain pre-flight)", () => {
  it("accepts a well-formed lowercase FQDN", () => {
    expect(validateHostname("www.example.com")).toEqual({
      ok: true,
      value: "www.example.com",
    });
    expect(validateHostname("a.b.example.co.uk").ok).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(validateHostname("  www.example.com  ")).toEqual({
      ok: true,
      value: "www.example.com",
    });
  });

  it("rejects an empty hostname", () => {
    expect(validateHostname("").ok).toBe(false);
    expect(validateHostname("   ").ok).toBe(false);
  });

  it("rejects a bare label (not a fully-qualified domain)", () => {
    expect(validateHostname("localhost").ok).toBe(false);
  });

  it("rejects uppercase hostnames", () => {
    expect(validateHostname("WWW.Example.com").ok).toBe(false);
  });

  it("rejects invalid characters / malformed labels", () => {
    expect(validateHostname("ex ample.com").ok).toBe(false);
    expect(validateHostname("-bad.example.com").ok).toBe(false);
    expect(validateHostname("bad-.example.com").ok).toBe(false);
    expect(validateHostname("under_score.example.com").ok).toBe(false);
  });

  it("rejects an over-long hostname", () => {
    const long = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.example.com`;
    expect(validateHostname(long).ok).toBe(false);
  });
});

describe("htmlTitle", () => {
  it("extracts the document title", () => {
    expect(htmlTitle("<html><head><title>Q3 Revenue Report</title></head></html>")).toBe(
      "Q3 Revenue Report",
    );
  });

  it("is case-insensitive and tolerates attributes on the tag", () => {
    expect(htmlTitle('<TITLE lang="en">Hello</TITLE>')).toBe("Hello");
  });

  it("collapses surrounding whitespace and newlines", () => {
    expect(htmlTitle("<title>\n  Spaced   Out\n</title>")).toBe("Spaced Out");
  });

  it("drops character references rather than slugifying them into words", () => {
    // `&amp;` must not become the word "amp" in the derived slug.
    expect(htmlTitle("<title>R&amp;D Notes</title>")).toBe("R D Notes");
  });

  it("returns null when there is no title, or it is empty", () => {
    expect(htmlTitle("<html><body>hi</body></html>")).toBeNull();
    expect(htmlTitle("<title></title>")).toBeNull();
    expect(htmlTitle("<title>   </title>")).toBeNull();
  });

  it("strips markup inside the title rather than slugifying the tags", () => {
    // `<title>` may not legally hold elements, but real documents ship them —
    // and `foo-b-bar-b` is the exact markup-in-the-URL bug this guards.
    expect(htmlTitle("<title>Foo <b>bar</b></title>")).toBe("Foo bar");
    expect(deriveSlug(htmlTitle("<title>Q3 <em>Draft</em></title>")!)).toEqual({
      ok: true,
      value: "q3-draft",
    });
  });

  it("takes the first title only", () => {
    expect(htmlTitle("<title>First</title><svg><title>Icon</title></svg>")).toBe("First");
  });

  it("feeds deriveSlug a human handle instead of markup", () => {
    const title = htmlTitle("<!doctype html><html lang=\"en\"><head><title>Action Items Review</title>");
    expect(deriveSlug(title!)).toEqual({ ok: true, value: "action-items-review" });
  });
});
