import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  API_CATALOG_PATH,
  OAUTH_AS_METADATA_PATH,
  buildApiCatalog,
  buildOAuthAuthorizationServerMetadata,
} from "./wellknown.js";
import {
  SCOPE_DOMAINS_BIND,
  SCOPE_PAGES_READ,
  SCOPE_PAGES_WRITE,
} from "../shared/src/scopes.js";

/**
 * Discovery-document tests (CLOUD-42).
 *
 * Golden fixtures: BOTH documents are byte-stable for a FIXED base URL (the
 * deploy-time issuer that CLOUD-30b injects). The structural assertions then
 * pin the RFC-required fields + cross-check that the advertised device/token
 * endpoints and scopes match the auth config (`convex/auth.ts`) and
 * `shared/src/scopes.ts` — so the discovery surface can never silently drift
 * from what actually authenticates.
 */

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OAUTH_GOLDEN = path.join(
  DIR,
  "__fixtures__",
  "oauth-authorization-server.golden.json",
);
const CATALOG_GOLDEN = path.join(
  DIR,
  "__fixtures__",
  "api-catalog.golden.json",
);

/** Fixed issuer (matches the device-flow endpoints the CLI POSTs to). */
const BASE_URL = "https://cloud.shortwind.dev";

/** Stable serialization (2-space indent + trailing newline). */
function serialize(doc: unknown): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

describe("buildOAuthAuthorizationServerMetadata — golden", () => {
  it("is byte-stable for a fixed issuer (RFC 8414 / 9728)", () => {
    const out = serialize(buildOAuthAuthorizationServerMetadata(BASE_URL));
    if (!existsSync(OAUTH_GOLDEN) || process.env["UPDATE_GOLDEN"] === "1") {
      writeFileSync(OAUTH_GOLDEN, out);
    }
    expect(out).toBe(readFileSync(OAUTH_GOLDEN, "utf8"));
  });
});

describe("buildApiCatalog — golden", () => {
  it("is byte-stable for a fixed issuer (RFC 9727)", () => {
    const out = serialize(buildApiCatalog(BASE_URL));
    if (!existsSync(CATALOG_GOLDEN) || process.env["UPDATE_GOLDEN"] === "1") {
      writeFileSync(CATALOG_GOLDEN, out);
    }
    expect(out).toBe(readFileSync(CATALOG_GOLDEN, "utf8"));
  });
});

describe("oauth-authorization-server metadata — RFC-required fields", () => {
  const doc = buildOAuthAuthorizationServerMetadata(BASE_URL);

  it("serves at the RFC 8414 well-known path", () => {
    expect(OAUTH_AS_METADATA_PATH).toBe(
      "/.well-known/oauth-authorization-server",
    );
  });

  it("sets issuer to the (trailing-slash-normalized) base URL", () => {
    expect(doc["issuer"]).toBe(BASE_URL);
    // Trailing slashes are stripped so endpoints join cleanly.
    expect(buildOAuthAuthorizationServerMetadata(BASE_URL + "/")["issuer"]).toBe(
      BASE_URL,
    );
  });

  it("points device + token endpoints at the real device-flow routes", () => {
    // These MUST equal the URLs the CLI POSTs to in cli/src/commands/login.ts.
    expect(doc["device_authorization_endpoint"]).toBe(
      `${BASE_URL}/oauth/device/code`,
    );
    expect(doc["token_endpoint"]).toBe(`${BASE_URL}/oauth/token`);
  });

  it("advertises exactly the three scopes from shared/src/scopes.ts", () => {
    expect(doc["scopes_supported"]).toEqual([
      SCOPE_PAGES_READ,
      SCOPE_PAGES_WRITE,
      SCOPE_DOMAINS_BIND,
    ]);
  });

  it("advertises the device-code + refresh-token grants (RFC 8628 + 6749)", () => {
    const grants = doc["grant_types_supported"] as string[];
    expect(grants).toContain(
      "urn:ietf:params:oauth:grant-type:device_code",
    );
    expect(grants).toContain("refresh_token");
  });

  it("declares the public-client posture (no client secret)", () => {
    expect(doc["token_endpoint_auth_methods_supported"]).toEqual(["none"]);
    expect(doc["response_types_supported"]).toEqual(["token"]);
    expect(doc["bearer_methods_supported"]).toEqual(["header"]);
  });

  it("uses absolute https URLs for every endpoint (schema-valid-ish)", () => {
    for (const key of [
      "issuer",
      "device_authorization_endpoint",
      "token_endpoint",
    ] as const) {
      expect(String(doc[key])).toMatch(/^https:\/\//);
      // Constructible URL → well-formed.
      expect(() => new URL(String(doc[key]))).not.toThrow();
    }
  });
});

describe("api-catalog — RFC 9727 endpoint catalog", () => {
  const catalog = buildApiCatalog(BASE_URL);

  it("serves at the RFC 9727 well-known path", () => {
    expect(API_CATALOG_PATH).toBe("/.well-known/api-catalog");
  });

  it("advertises every PRD §4 REST verb exactly once", () => {
    const rels = catalog.apis.map((a) => a.rel);
    expect(rels).toEqual([
      "find",
      "publish",
      "publish-bundle",
      "update",
      "get",
      "delete",
      "visibility",
      "bind-domain",
    ]);
    expect(new Set(rels).size).toBe(rels.length);
  });

  it("maps each verb to the method + path http.ts registers", () => {
    const byRel = Object.fromEntries(catalog.apis.map((a) => [a.rel, a]));
    expect(byRel["find"]?.method).toBe("GET");
    expect(byRel["find"]?.href).toBe(
      `${BASE_URL}/v1/pages?q={q}&domain={domain}&tag={tag}`,
    );
    expect(byRel["publish"]).toMatchObject({
      method: "POST",
      href: `${BASE_URL}/v1/pages`,
    });
    expect(byRel["update"]).toMatchObject({
      method: "PATCH",
      href: `${BASE_URL}/v1/pages/{id}`,
    });
    expect(byRel["get"]).toMatchObject({
      method: "GET",
      href: `${BASE_URL}/v1/pages/{id}`,
    });
    expect(byRel["delete"]).toMatchObject({
      method: "DELETE",
      href: `${BASE_URL}/v1/pages/{id}`,
    });
    expect(byRel["visibility"]).toMatchObject({
      method: "PATCH",
      href: `${BASE_URL}/v1/pages/{id}/visibility`,
    });
    expect(byRel["bind-domain"]).toMatchObject({
      method: "POST",
      href: `${BASE_URL}/v1/pages/{id}/domain`,
    });
  });

  it("gates bind-domain on domains:bind and reads on pages:read", () => {
    const byRel = Object.fromEntries(catalog.apis.map((a) => [a.rel, a]));
    expect(byRel["bind-domain"]?.scope).toBe(SCOPE_DOMAINS_BIND);
    expect(byRel["find"]?.scope).toBe(SCOPE_PAGES_READ);
    expect(byRel["publish"]?.scope).toBe(SCOPE_PAGES_WRITE);
  });

  it("gives every entry a description + an absolute https href", () => {
    for (const entry of catalog.apis) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.href).toMatch(/^https:\/\//);
    }
  });
});
