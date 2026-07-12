import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCOPES,
  SCOPES,
  SCOPE_DOMAINS_BIND,
  SCOPE_MODERATION_ADMIN,
  SCOPE_PAGES_READ,
  SCOPE_PAGES_WRITE,
  isScope,
} from "./scopes.js";

describe("scopes", () => {
  it("exposes the canonical scope strings", () => {
    expect(SCOPE_PAGES_READ).toBe("pages:read");
    expect(SCOPE_PAGES_WRITE).toBe("pages:write");
    expect(SCOPE_DOMAINS_BIND).toBe("domains:bind");
    expect(SCOPE_MODERATION_ADMIN).toBe("moderation:admin");
  });

  it("lists every scope in SCOPES with no duplicates", () => {
    expect(SCOPES).toEqual([
      "pages:read",
      "pages:write",
      "domains:bind",
      "moderation:admin",
    ]);
    expect(new Set(SCOPES).size).toBe(SCOPES.length);
  });

  it("defaults a device-flow token to read+write but NOT domains:bind or moderation:admin", () => {
    expect(DEFAULT_SCOPES).toContain(SCOPE_PAGES_READ);
    expect(DEFAULT_SCOPES).toContain(SCOPE_PAGES_WRITE);
    expect(DEFAULT_SCOPES).not.toContain(SCOPE_DOMAINS_BIND);
    expect(DEFAULT_SCOPES).not.toContain(SCOPE_MODERATION_ADMIN);
  });

  it("recognizes valid scopes and rejects everything else", () => {
    for (const scope of SCOPES) {
      expect(isScope(scope)).toBe(true);
    }
    expect(isScope("pages:delete")).toBe(false);
    expect(isScope("")).toBe(false);
    expect(isScope(undefined)).toBe(false);
    expect(isScope(42)).toBe(false);
  });
});
