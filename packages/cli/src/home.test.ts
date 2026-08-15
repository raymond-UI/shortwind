import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  HOME_DIRNAME,
  LOCK_FILENAME,
  RECIPES_DIRNAME,
  homePaths,
  readHomeLockfile,
  resolveHome,
  writeHomeLockfile,
} from "./home.js";

// Each test gets its own throwaway sandbox so the SHORTWIND_HOME override never
// leaks across cases.
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
