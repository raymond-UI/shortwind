import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { login } from "./login.js";
import { loadCredentials, readActiveAccount, globalHomeRoot, type HomeEnv } from "../../home.js";
import type {
  DeviceAuthorization,
  DeviceFlowIO,
  PollResponse,
} from "../device-flow.js";

let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "sw-login-"));
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function env(): HomeEnv {
  return { HOME: sandbox, SHORTWIND_HOME: path.join(sandbox, ".shortwind") };
}

const AUTH: DeviceAuthorization = {
  deviceCode: "dev-xyz",
  userCode: "WDJB-MJHT",
  verificationUri: "https://shortwind.dev/device",
  expiresIn: 600,
  interval: 5,
};

/** A faked device-flow IO that yields the given token immediately. */
function fakeIO(token: PollResponse): DeviceFlowIO {
  return {
    async requestDeviceAuthorization() {
      return AUTH;
    },
    async pollToken() {
      return token;
    },
    onUserCode() {},
    async sleep() {},
    now() {
      return 0;
    },
  };
}

const TOKEN_ALICE: PollResponse = {
  kind: "token",
  token: { accessToken: "tok_alice", tokenType: "bearer", refreshToken: "ref_a" },
};
const TOKEN_BOB: PollResponse = {
  kind: "token",
  token: { accessToken: "tok_bob", tokenType: "bearer" },
};

describe("login — happy path", () => {
  it("runs the device flow and stores the token bound to the account, active", async () => {
    const result = await login(
      {},
      {
        env: env(),
        io: fakeIO(TOKEN_ALICE),
        resolveAccount: async () => ({ id: "acct_alice", label: "alice@example.com" }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.account.id).toBe("acct_alice");

    const home = globalHomeRoot(env());
    const active = readActiveAccount(home);
    expect(active?.id).toBe("acct_alice");
    expect(active?.token.accessToken).toBe("tok_alice");
    expect(active?.label).toBe("alice@example.com");
  });

  it("passes the requested scopes through to the device flow and stores them", async () => {
    let requestedScope: string | undefined;
    const io: DeviceFlowIO = {
      async requestDeviceAuthorization(input) {
        requestedScope = input.scope;
        return AUTH;
      },
      async pollToken() {
        return TOKEN_ALICE;
      },
      onUserCode() {},
      async sleep() {},
      now() {
        return 0;
      },
    };
    await login(
      { scope: ["pages:write", "domains:bind"] },
      { env: env(), io, resolveAccount: async () => ({ id: "acct_alice", label: "alice" }) },
    );
    expect(requestedScope).toBe("pages:write domains:bind");
    const active = readActiveAccount(globalHomeRoot(env()));
    expect(active?.scopes).toEqual(["pages:write", "domains:bind"]);
  });

  it("defaults to pages:read + pages:write scopes when none requested", async () => {
    let requestedScope: string | undefined;
    const io: DeviceFlowIO = {
      async requestDeviceAuthorization(input) {
        requestedScope = input.scope;
        return AUTH;
      },
      async pollToken() {
        return TOKEN_ALICE;
      },
      onUserCode() {},
      async sleep() {},
      now() {
        return 0;
      },
    };
    await login(
      {},
      { env: env(), io, resolveAccount: async () => ({ id: "acct_alice", label: "alice" }) },
    );
    expect(requestedScope).toBe("pages:read pages:write");
  });
});

describe("login — step-up scope is not persisted (#156)", () => {
  it("requests domains:bind over the wire but persists ONLY the non-elevated scopes", async () => {
    let requestedScope: string | undefined;
    const io: DeviceFlowIO = {
      async requestDeviceAuthorization(input) {
        requestedScope = input.scope;
        return AUTH;
      },
      async pollToken() {
        return TOKEN_ALICE;
      },
      onUserCode() {},
      async sleep() {},
      now() {
        return 0;
      },
    };
    // Mirrors cli.ts `stepUpBindScope`: request the elevated scope, persist only
    // the pre-existing set so domains:bind never leaks into the stored credential.
    await login(
      {
        scope: ["pages:read", "pages:write", "domains:bind"],
        persistScopes: ["pages:read", "pages:write"],
      },
      { env: env(), io, resolveAccount: async () => ({ id: "acct_alice", label: "alice" }) },
    );
    // The wire request DID carry the elevated scope (the human approves it)...
    expect(requestedScope).toBe("pages:read pages:write domains:bind");
    // ...but the persisted credential does NOT include domains:bind.
    const active = readActiveAccount(globalHomeRoot(env()));
    expect(active?.scopes).toEqual(["pages:read", "pages:write"]);
    expect(active?.scopes).not.toContain("domains:bind");
  });
});

describe("login — multi-account switch (gh auth switch semantics)", () => {
  it("a second login with a different account adds + switches active to it", async () => {
    await login(
      {},
      { env: env(), io: fakeIO(TOKEN_ALICE), resolveAccount: async () => ({ id: "acct_alice", label: "alice" }) },
    );
    await login(
      {},
      { env: env(), io: fakeIO(TOKEN_BOB), resolveAccount: async () => ({ id: "acct_bob", label: "bob" }) },
    );

    const home = globalHomeRoot(env());
    const creds = loadCredentials(home);
    expect(creds.active).toBe("acct_bob");
    expect(Object.keys(creds.accounts).sort()).toEqual(["acct_alice", "acct_bob"]);
    // Alice's token is retained for a later switch.
    expect(creds.accounts["acct_alice"]?.token.accessToken).toBe("tok_alice");
  });
});

describe("login — failure", () => {
  it("returns a denied result and stores nothing when the user denies", async () => {
    const result = await login(
      {},
      {
        env: env(),
        io: fakeIO({ kind: "error", code: "access_denied" }),
        resolveAccount: async () => ({ id: "acct_alice", label: "alice" }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("denied");
    expect(readActiveAccount(globalHomeRoot(env()))).toBeNull();
  });

  it("returns expired when the device code lapses", async () => {
    const result = await login(
      {},
      {
        env: env(),
        io: fakeIO({ kind: "error", code: "expired_token" }),
        resolveAccount: async () => ({ id: "acct_alice", label: "alice" }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("expired");
  });
});
