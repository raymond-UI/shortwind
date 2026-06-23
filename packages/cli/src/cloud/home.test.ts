import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CREDENTIALS_FILENAME,
  HOME_DIRNAME,
  LOCK_FILENAME,
  RECIPES_DIRNAME,
  addAccount,
  homePaths,
  loadCredentials,
  readActiveAccount,
  readHomeLockfile,
  resolveHome,
  saveCredentials,
  switchAccount,
  writeHomeLockfile,
  type Credentials,
} from "./home.js";

// Each test gets its own throwaway sandbox so the credential store and the
// SHORTWIND_HOME override never leak across cases.
let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "sw-home-"));
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("resolveHome — precedence", () => {
  it("uses a local repo recipes/ when present in cwd", () => {
    const repo = path.join(sandbox, "repo");
    mkdirSync(path.join(repo, "recipes"), { recursive: true });
    const home = resolveHome({ cwd: repo, env: { HOME: sandbox } });
    expect(home.kind).toBe("local");
    expect(home.root).toBe(repo);
    expect(home.recipesDir).toBe(path.join(repo, "recipes"));
  });

  it("walks up to find a local recipes/ above the cwd", () => {
    const repo = path.join(sandbox, "repo");
    const deep = path.join(repo, "src", "pages");
    mkdirSync(path.join(repo, "recipes"), { recursive: true });
    mkdirSync(deep, { recursive: true });
    const home = resolveHome({ cwd: deep, env: { HOME: sandbox } });
    expect(home.kind).toBe("local");
    expect(home.root).toBe(repo);
  });

  it("falls back to the global ~/.shortwind/ home when no local recipes/", () => {
    const cwd = path.join(sandbox, "scratch");
    mkdirSync(cwd, { recursive: true });
    const home = resolveHome({ cwd, env: { HOME: sandbox } });
    expect(home.kind).toBe("global");
    expect(home.root).toBe(path.join(sandbox, HOME_DIRNAME));
    expect(home.recipesDir).toBe(path.join(sandbox, HOME_DIRNAME, RECIPES_DIRNAME));
  });

  it("honors SHORTWIND_HOME over both local and ~/.shortwind/", () => {
    const repo = path.join(sandbox, "repo");
    mkdirSync(path.join(repo, "recipes"), { recursive: true });
    const override = path.join(sandbox, "custom-home");
    const home = resolveHome({
      cwd: repo,
      env: { HOME: sandbox, SHORTWIND_HOME: override },
    });
    expect(home.kind).toBe("global");
    expect(home.root).toBe(override);
    expect(home.recipesDir).toBe(path.join(override, RECIPES_DIRNAME));
  });
});

describe("homePaths", () => {
  it("derives the palette, lockfile, and credentials paths under a root", () => {
    const root = path.join(sandbox, ".shortwind");
    const p = homePaths(root);
    expect(p.root).toBe(root);
    expect(p.recipesDir).toBe(path.join(root, RECIPES_DIRNAME));
    expect(p.lockfile).toBe(path.join(root, RECIPES_DIRNAME, LOCK_FILENAME));
    expect(p.credentials).toBe(path.join(root, CREDENTIALS_FILENAME));
  });
});

describe("credentials store — multi-account", () => {
  function home() {
    return path.join(sandbox, ".shortwind");
  }

  it("returns an empty store when none exists", () => {
    const creds = loadCredentials(home());
    expect(creds.active).toBeNull();
    expect(creds.accounts).toEqual({});
    expect(readActiveAccount(home())).toBeNull();
  });

  it("adds an account and makes it active on first login", () => {
    addAccount(home(), {
      id: "acct_alice",
      label: "alice@example.com",
      token: { accessToken: "tok_a", tokenType: "bearer" },
    });
    const creds = loadCredentials(home());
    expect(creds.active).toBe("acct_alice");
    expect(creds.accounts["acct_alice"]?.token.accessToken).toBe("tok_a");
    expect(readActiveAccount(home())?.id).toBe("acct_alice");
  });

  it("adding a second account switches active to it (gh-auth-switch semantics)", () => {
    addAccount(home(), {
      id: "acct_alice",
      label: "alice@example.com",
      token: { accessToken: "tok_a", tokenType: "bearer" },
    });
    addAccount(home(), {
      id: "acct_bob",
      label: "bob@example.com",
      token: { accessToken: "tok_b", tokenType: "bearer" },
    });
    const creds = loadCredentials(home());
    expect(creds.active).toBe("acct_bob");
    expect(Object.keys(creds.accounts).sort()).toEqual(["acct_alice", "acct_bob"]);
    expect(readActiveAccount(home())?.id).toBe("acct_bob");
  });

  it("switchAccount updates only the active pointer, keeping all accounts", () => {
    addAccount(home(), {
      id: "acct_alice",
      label: "alice@example.com",
      token: { accessToken: "tok_a", tokenType: "bearer" },
    });
    addAccount(home(), {
      id: "acct_bob",
      label: "bob@example.com",
      token: { accessToken: "tok_b", tokenType: "bearer" },
    });
    const after = switchAccount(home(), "acct_alice");
    expect(after.active).toBe("acct_alice");
    expect(readActiveAccount(home())?.id).toBe("acct_alice");
    // Bob's token survives the switch.
    expect(loadCredentials(home()).accounts["acct_bob"]?.token.accessToken).toBe("tok_b");
  });

  it("re-adding an existing account updates its token in place and re-activates it", () => {
    addAccount(home(), {
      id: "acct_alice",
      label: "alice@example.com",
      token: { accessToken: "tok_a1", tokenType: "bearer" },
    });
    addAccount(home(), {
      id: "acct_bob",
      label: "bob@example.com",
      token: { accessToken: "tok_b", tokenType: "bearer" },
    });
    addAccount(home(), {
      id: "acct_alice",
      label: "alice@example.com",
      token: { accessToken: "tok_a2", tokenType: "bearer" },
    });
    const creds = loadCredentials(home());
    expect(creds.active).toBe("acct_alice");
    expect(creds.accounts["acct_alice"]?.token.accessToken).toBe("tok_a2");
    expect(Object.keys(creds.accounts).length).toBe(2);
  });

  it("switchAccount on an unknown account id throws (a caller bug)", () => {
    addAccount(home(), {
      id: "acct_alice",
      label: "alice@example.com",
      token: { accessToken: "tok_a", tokenType: "bearer" },
    });
    expect(() => switchAccount(home(), "acct_ghost")).toThrow();
  });

  it("persists the credentials file under the home root", () => {
    addAccount(home(), {
      id: "acct_alice",
      label: "alice@example.com",
      token: { accessToken: "tok_a", tokenType: "bearer" },
    });
    expect(existsSync(homePaths(home()).credentials)).toBe(true);
    const raw = JSON.parse(readFileSync(homePaths(home()).credentials, "utf8")) as Credentials;
    expect(raw.active).toBe("acct_alice");
  });

  it("tolerates a corrupt credentials file by treating it as empty", () => {
    mkdirSync(home(), { recursive: true });
    writeFileSync(homePaths(home()).credentials, "{ not json");
    const creds = loadCredentials(home());
    expect(creds.active).toBeNull();
    expect(creds.accounts).toEqual({});
  });

  // Security hardening (#156): credentials.json holds bearer + refresh tokens,
  // so it must be owner-only (0600) and live under an owner-only (0700) home.
  // POSIX mode is unreliable on Windows, so skip there.
  const itPosix = process.platform === "win32" ? it.skip : it;
  itPosix("writes credentials 0600 under a 0700 home (owner-only secrets)", () => {
    addAccount(home(), {
      id: "acct_alice",
      label: "alice@example.com",
      token: { accessToken: "tok_a", tokenType: "bearer", refreshToken: "ref_a" },
    });
    const fileMode = statSync(homePaths(home()).credentials).mode & 0o777;
    expect(fileMode).toBe(0o600);
    const dirMode = statSync(home()).mode & 0o777;
    expect(dirMode).toBe(0o700);
  });

  itPosix("re-clamps the credentials mode to 0600 on a subsequent save", () => {
    const target = home();
    saveCredentials(target, { version: 1, active: null, accounts: {} });
    // Loosen the file deliberately, then a second save must lock it back down.
    chmodSync(homePaths(target).credentials, 0o644);
    saveCredentials(target, { version: 1, active: null, accounts: {} });
    expect(statSync(homePaths(target).credentials).mode & 0o777).toBe(0o600);
  });
});

describe("readHomeLockfile — corrupt-file handling (#156)", () => {
  function home() {
    return path.join(sandbox, ".shortwind");
  }

  it("returns an empty lockfile when none exists", () => {
    const lock = readHomeLockfile(home(), "reg");
    expect(lock.families).toEqual({});
    expect(lock.registry).toBe("reg");
  });

  it("round-trips a written lockfile", () => {
    writeHomeLockfile(home(), {
      version: 1,
      registry: "reg",
      families: { card: { version: "1.0.0", sha: "abc" } },
    });
    expect(readHomeLockfile(home()).families["card"]?.sha).toBe("abc");
  });

  it("throws a FRIENDLY error (not a raw SyntaxError) on a corrupt lockfile", () => {
    mkdirSync(homePaths(home()).recipesDir, { recursive: true });
    writeFileSync(homePaths(home()).lockfile, "{ not json");
    expect(() => readHomeLockfile(home())).toThrow(/corrupt lockfile/);
  });
});
