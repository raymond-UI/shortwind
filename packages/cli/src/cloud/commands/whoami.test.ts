import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderWhoami, runWhoami, type WhoamiEnv } from "./whoami.js";
import { addAccount, globalHomeRoot, type Credentials } from "../../home.js";
import type { DeviceToken } from "../device-flow.js";

/**
 * whoami tests — the pure render over fixed credentials, plus the IO shell over
 * a sandbox home (no real `~/.shortwind`).
 */

const TOKEN: DeviceToken = { accessToken: "swc_abc", tokenType: "bearer" };

function creds(active: string | null, accounts: Credentials["accounts"]): Credentials {
  return { version: 1, active, accounts };
}

describe("renderWhoami (pure)", () => {
  it("reports not-logged-in when there is no active account", () => {
    const out = renderWhoami(creds(null, {}), "https://api.shortwind.dev", false);
    expect(out.loggedIn).toBe(false);
    expect(out.output).toMatch(/not logged in/i);
  });

  it("shows the active account's label, id, scopes, and endpoint", () => {
    const c = creds("acct_1", {
      acct_1: { id: "acct_1", label: "dev@example.com", token: TOKEN, scopes: ["pages:read", "pages:write"], addedAt: "2026-07-17T00:00:00.000Z" },
    });
    const out = renderWhoami(c, "https://api.shortwind.dev", false);
    expect(out.loggedIn).toBe(true);
    expect(out.output).toContain("dev@example.com");
    expect(out.output).toContain("acct_1");
    expect(out.output).toContain("pages:read, pages:write");
    expect(out.output).toContain("https://api.shortwind.dev");
  });

  it("lists other stored accounts", () => {
    const c = creds("acct_1", {
      acct_1: { id: "acct_1", label: "a@x.com", token: TOKEN },
      acct_2: { id: "acct_2", label: "b@x.com", token: TOKEN },
    });
    const out = renderWhoami(c, "https://api.shortwind.dev", false);
    expect(out.output).toMatch(/Other accounts: b@x\.com/);
  });

  it("emits machine-readable JSON with --json", () => {
    const c = creds("acct_1", {
      acct_1: { id: "acct_1", label: "dev@example.com", token: TOKEN, scopes: ["pages:read"] },
    });
    const out = renderWhoami(c, "https://api.shortwind.dev", true);
    const parsed = JSON.parse(out.output);
    expect(parsed).toMatchObject({
      loggedIn: true,
      endpoint: "https://api.shortwind.dev",
      active: { id: "acct_1", label: "dev@example.com", scopes: ["pages:read"] },
    });
  });

  it("JSON reports loggedIn:false when logged out", () => {
    const parsed = JSON.parse(renderWhoami(creds(null, {}), "https://api.shortwind.dev", true).output);
    expect(parsed).toMatchObject({ loggedIn: false, active: null, accounts: [] });
  });
});

describe("runWhoami (IO shell over a sandbox home)", () => {
  let sandbox: string;
  beforeEach(() => {
    sandbox = mkdtempSync(path.join(tmpdir(), "sw-whoami-"));
  });
  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });
  function env(): WhoamiEnv {
    return { HOME: sandbox, SHORTWIND_HOME: path.join(sandbox, ".shortwind") };
  }

  it("reads the active account written to the global home", () => {
    addAccount(globalHomeRoot(env()), {
      id: "acct_live",
      label: "me@shortwind.dev",
      token: TOKEN,
      scopes: ["pages:read", "pages:write"],
    });
    const out = runWhoami({}, env());
    expect(out.loggedIn).toBe(true);
    expect(out.output).toContain("me@shortwind.dev");
    expect(out.output).toContain("acct_live");
  });

  it("reports not-logged-in for an empty home", () => {
    const out = runWhoami({}, env());
    expect(out.loggedIn).toBe(false);
    expect(out.output).toMatch(/not logged in/i);
  });
});
