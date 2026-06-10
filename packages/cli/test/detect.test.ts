import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProject } from "../src/detect.js";

describe("detectProject — package manager", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  async function project(files: Record<string, string>): Promise<string> {
    const dir = realpathSync(await mkdtemp(path.join(tmpdir(), "shortwind-detect-")));
    dirs.push(dir);
    for (const [rel, body] of Object.entries(files)) {
      await writeFile(path.join(dir, rel), body);
    }
    return dir;
  }

  const pkg = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ name: "x", version: "0.0.0", ...extra });

  it("defaults to npm with no lockfile and no packageManager field", async () => {
    const dir = await project({ "package.json": pkg() });
    expect(detectProject(dir).packageManager).toBe("npm");
  });

  it("defaults to npm when there is no package.json at all", async () => {
    const dir = await project({});
    expect(detectProject(dir).packageManager).toBe("npm");
  });

  it("reads each lockfile", async () => {
    const npm = await project({ "package.json": pkg(), "package-lock.json": "{}" });
    expect(detectProject(npm).packageManager).toBe("npm");

    const pnpm = await project({ "package.json": pkg(), "pnpm-lock.yaml": "" });
    expect(detectProject(pnpm).packageManager).toBe("pnpm");

    const yarn = await project({ "package.json": pkg(), "yarn.lock": "" });
    expect(detectProject(yarn).packageManager).toBe("yarn");

    const bun = await project({ "package.json": pkg(), "bun.lockb": "" });
    expect(detectProject(bun).packageManager).toBe("bun");
  });

  it("prefers an explicit packageManager field over a lockfile", async () => {
    // a stray pnpm-lock must not override an explicit corepack declaration
    const dir = await project({
      "package.json": pkg({ packageManager: "yarn@4.1.0" }),
      "pnpm-lock.yaml": "",
    });
    expect(detectProject(dir).packageManager).toBe("yarn");
  });
});
