import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { initGlobal } from "./init-global.js";
import { LOCK_FILENAME, LOCK_VERSION, RECIPES_DIRNAME, globalHomeRoot } from "../home.js";

let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "sw-init-"));
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function env() {
  // SHORTWIND_HOME pins the global home into the sandbox so nothing touches the
  // developer's real ~/.shortwind.
  return { HOME: sandbox, SHORTWIND_HOME: path.join(sandbox, ".shortwind") };
}

describe("init --global", () => {
  it("creates the expected tree: palette dir, lockfile, SKILL.md", async () => {
    const result = await initGlobal({}, { env: env() });
    const root = globalHomeRoot(env());

    expect(result.created).toBe(true);
    expect(result.home).toBe(root);
    expect(existsSync(path.join(root, RECIPES_DIRNAME))).toBe(true);
    expect(existsSync(path.join(root, RECIPES_DIRNAME, LOCK_FILENAME))).toBe(true);
    expect(existsSync(path.join(root, "SKILL.md"))).toBe(true);
  });

  it("writes a lockfile with the CLOUD-03 shape (version, registry, families)", async () => {
    await initGlobal({}, { env: env() });
    const root = globalHomeRoot(env());
    const lock = JSON.parse(
      readFileSync(path.join(root, RECIPES_DIRNAME, LOCK_FILENAME), "utf8"),
    );
    expect(lock).toEqual({
      version: LOCK_VERSION,
      registry: expect.any(String),
      families: {},
    });
  });

  it("renders a SKILL.md mentioning the global home + publish", async () => {
    await initGlobal({}, { env: env() });
    const root = globalHomeRoot(env());
    const skill = readFileSync(path.join(root, "SKILL.md"), "utf8");
    expect(skill).toMatch(/shortwind/i);
    expect(skill).toMatch(/publish/i);
  });

  it("is idempotent: a second run does not overwrite and reports created=false", async () => {
    await initGlobal({}, { env: env() });
    const root = globalHomeRoot(env());
    const lockPath = path.join(root, RECIPES_DIRNAME, LOCK_FILENAME);
    // Mutate the lockfile to prove the second run leaves it untouched.
    const marker = { version: LOCK_VERSION, registry: "marker", families: {} };
    writeFileSync(lockPath, JSON.stringify(marker, null, 2) + "\n");

    const result = await initGlobal({}, { env: env() });
    expect(result.created).toBe(false);
    const after = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(after.registry).toBe("marker");
  });

  it("--force overwrites an existing home", async () => {
    await initGlobal({}, { env: env() });
    const root = globalHomeRoot(env());
    const lockPath = path.join(root, RECIPES_DIRNAME, LOCK_FILENAME);
    writeFileSync(lockPath, JSON.stringify({ version: 9, registry: "stale", families: {} }));

    const result = await initGlobal({ force: true }, { env: env() });
    expect(result.created).toBe(true);
    const after = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(after.registry).not.toBe("stale");
    expect(after.version).toBe(LOCK_VERSION);
  });

  it("records the endpoint when given", async () => {
    const result = await initGlobal(
      { endpoint: "https://api.example.com" },
      { env: env() },
    );
    expect(result.endpoint).toBe("https://api.example.com");
  });

  it("creates the home even when a sibling dir already exists (mkdir recursive)", async () => {
    const root = globalHomeRoot(env());
    mkdirSync(root, { recursive: true });
    const result = await initGlobal({}, { env: env() });
    expect(result.created).toBe(true);
    expect(existsSync(path.join(root, RECIPES_DIRNAME, LOCK_FILENAME))).toBe(true);
  });
});
