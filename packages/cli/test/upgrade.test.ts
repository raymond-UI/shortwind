import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { init } from "../src/init.js";
import { upgrade, UpgradeError, type UpgradeResolver } from "../src/commands/upgrade.js";
import { verify } from "../src/commands/verify.js";
import { readLockfile } from "../src/lockfile.js";
import { computeBodySha, extractHeader, rewriteHeaderSha } from "../src/fingerprint.js";
import type { RegistrySource } from "../src/registry-source.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(here, "..", "..", "registry");

type RegistryDef = {
  presets?: Record<string, string[] | "*">;
  families: Record<string, { version: string; body: string }>;
};

function mockSource(def: RegistryDef): RegistrySource {
  const families = def.families;
  return {
    origin: "mock://test",
    async loadPresets() {
      return def.presets ?? { all: "*" };
    },
    async loadFamily(family) {
      const entry = families[family];
      if (!entry) throw new Error(`family ${family} not found`);
      const header = `/* shortwind: ${family}@${entry.version} sha:000000 — DO NOT EDIT THIS LINE */`;
      return `${header}\n${entry.body}`;
    },
    async listAllFamilies() {
      return Object.keys(families).sort();
    },
  };
}

async function setupProject(): Promise<string> {
  const raw = await mkdtemp(path.join(tmpdir(), "shortwind-upgrade-"));
  const dir = realpathSync(raw);
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", version: "0.0.0" }, null, 2),
  );
  await init({
    cwd: dir,
    preset: "starter",
    registry: REGISTRY_PATH,
    installPackages: async () => {},
  });
  return dir;
}

describe("upgrade", () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("applies pristine updates and seals new sha", async () => {
    const dir = await setupProject();
    dirs.push(dir);

    const source = mockSource({
      families: {
        card: { version: "0.0.2", body: "/* card. */\n@recipe card { p-8 }\n" },
      },
    });
    const result = await upgrade({ cwd: dir, families: ["card"], source });

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({
      family: "card",
      action: "updated",
      to: "0.0.2",
    });
    const written = readFileSync(path.join(dir, "recipes", "card.css"), "utf8");
    const header = extractHeader(written);
    expect(header?.version).toBe("0.0.2");
    expect(header?.sha).toBe(computeBodySha(written));
    expect(header?.sha).not.toBe("000000");

    const lock = await readLockfile(path.join(dir, "recipes"));
    expect(lock.families["card"]).toEqual({ version: "0.0.2", sha: header?.sha });
  });

  it("is a no-op when registry version matches lockfile", async () => {
    const dir = await setupProject();
    dirs.push(dir);

    const source = mockSource({
      families: {
        card: { version: "0.0.1", body: "/* card. */\n@recipe card { p-4 }\n" },
      },
    });
    const result = await upgrade({ cwd: dir, families: ["card"], source });

    expect(result.outcomes[0]?.action).toBe("kept");
    expect(result.hasUpdates).toBe(false);
  });

  it("detects touched file and consults the resolver", async () => {
    const dir = await setupProject();
    dirs.push(dir);

    // user-edits card.css after install
    const cardPath = path.join(dir, "recipes", "card.css");
    const original = readFileSync(cardPath, "utf8");
    writeFileSync(cardPath, original + "\n/* user edit */\n");

    const calls: string[] = [];
    const resolver: UpgradeResolver = async (ctx) => {
      calls.push(ctx.family);
      return "keep";
    };

    const source = mockSource({
      families: {
        card: { version: "0.0.2", body: "/* card. */\n@recipe card { p-12 }\n" },
      },
    });

    const result = await upgrade({ cwd: dir, families: ["card"], source, resolver });
    expect(calls).toEqual(["card"]);
    expect(result.outcomes[0]).toMatchObject({
      family: "card",
      action: "kept",
      reason: "user-chose-keep",
    });
    // file unchanged
    expect(readFileSync(cardPath, "utf8")).toBe(original + "\n/* user edit */\n");
  });

  it("touched + resolver accept overwrites local edits", async () => {
    const dir = await setupProject();
    dirs.push(dir);

    const cardPath = path.join(dir, "recipes", "card.css");
    const original = readFileSync(cardPath, "utf8");
    writeFileSync(cardPath, original + "\n/* user edit */\n");

    const source = mockSource({
      families: {
        card: { version: "0.0.2", body: "/* card. */\n@recipe card { p-12 }\n" },
      },
    });
    const resolver: UpgradeResolver = async () => "accept";
    const result = await upgrade({ cwd: dir, families: ["card"], source, resolver });

    expect(result.outcomes[0]?.action).toBe("updated");
    const written = readFileSync(cardPath, "utf8");
    expect(written).toContain("@recipe card { p-12 }");
    expect(written).not.toContain("user edit");
  });

  it("--force bypasses touched detection", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    const cardPath = path.join(dir, "recipes", "card.css");
    writeFileSync(cardPath, readFileSync(cardPath, "utf8") + "\n/* mine */\n");

    let resolverCalled = false;
    const resolver: UpgradeResolver = async () => {
      resolverCalled = true;
      return "skip";
    };

    const source = mockSource({
      families: { card: { version: "0.0.2", body: "/* card. */\n@recipe card { p-8 }\n" } },
    });
    const result = await upgrade({
      cwd: dir,
      families: ["card"],
      source,
      force: true,
      resolver,
    });
    expect(resolverCalled).toBe(false);
    expect(result.outcomes[0]?.action).toBe("updated");
  });

  it("handles mixed states across families in one run", async () => {
    const dir = await setupProject();
    dirs.push(dir);

    // touch button only
    const btnPath = path.join(dir, "recipes", "button.css");
    writeFileSync(btnPath, readFileSync(btnPath, "utf8") + "\n/* user */\n");

    const source = mockSource({
      families: {
        // card → newer (pristine, will update)
        card: { version: "0.0.2", body: "/* card. */\n@recipe card { p-8 }\n" },
        // button → newer, but touched → skipped by default resolver
        button: { version: "0.0.2", body: "/* btn. */\n@recipe btn { px-4 }\n" },
        // form → same version (unchanged)
        form: { version: "0.0.2", body: "/* form. */\n@recipe form { gap-2 }\n" },
      },
    });

    const result = await upgrade({
      cwd: dir,
      families: ["card", "button", "form"],
      source,
      resolver: async () => "skip",
    });

    const byFamily = Object.fromEntries(result.outcomes.map((o) => [o.family, o]));
    expect(byFamily["card"]?.action).toBe("updated");
    expect(byFamily["button"]?.action).toBe("skipped");
    expect(byFamily["form"]?.action).toBe("kept");
  });

  it("--check reports drift without writing", async () => {
    const dir = await setupProject();
    dirs.push(dir);

    const cardBefore = readFileSync(path.join(dir, "recipes", "card.css"), "utf8");
    const lockBefore = JSON.stringify(
      await readLockfile(path.join(dir, "recipes")),
    );

    const source = mockSource({
      families: {
        card: { version: "0.0.5", body: "/* card. */\n@recipe card { p-10 }\n" },
        button: { version: "0.0.1", body: "/* btn. */\n@recipe btn { px-3 }\n" },
      },
    });
    const result = await upgrade({
      cwd: dir,
      families: ["card", "button"],
      source,
      check: true,
    });
    expect(result.hasUpdates).toBe(true);
    expect(result.outcomes.find((o) => o.family === "card")?.action).toBe("would-update");

    // nothing changed on disk
    expect(readFileSync(path.join(dir, "recipes", "card.css"), "utf8")).toBe(cardBefore);
    expect(JSON.stringify(await readLockfile(path.join(dir, "recipes")))).toBe(lockBefore);
  });

  it("--check exits clean when no updates", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    const source = mockSource({
      families: {
        card: { version: "0.0.1", body: "/* card. */\n@recipe card { p-4 }\n" },
      },
    });
    const result = await upgrade({
      cwd: dir,
      families: ["card"],
      source,
      check: true,
    });
    expect(result.hasUpdates).toBe(false);
    expect(result.hasTouched).toBe(false);
  });

  it("--check flags touched-as-review when version also changed", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    const cardPath = path.join(dir, "recipes", "card.css");
    writeFileSync(cardPath, readFileSync(cardPath, "utf8") + "\n/* mine */\n");

    const source = mockSource({
      families: {
        card: { version: "0.0.3", body: "/* card. */\n@recipe card { p-8 }\n" },
      },
    });
    const result = await upgrade({
      cwd: dir,
      families: ["card"],
      source,
      check: true,
    });
    expect(result.hasTouched).toBe(true);
    expect(result.outcomes[0]?.action).toBe("would-review");
  });

  it("propagates registry errors via UpgradeError", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    const source: RegistrySource = {
      origin: "mock://broken",
      async loadPresets() {
        return {};
      },
      async loadFamily() {
        throw new Error("404");
      },
      async listAllFamilies() {
        return [];
      },
    };
    await expect(
      upgrade({ cwd: dir, families: ["card"], source }),
    ).rejects.toBeInstanceOf(UpgradeError);
  });

  it("regenerates SKILL.md when at least one family updated", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    const skillPath = path.join(dir, "skills", "shortwind", "SKILL.md");
    const before = readFileSync(skillPath, "utf8");
    const source = mockSource({
      families: {
        card: { version: "0.0.2", body: "/* card. */\n@recipe card { p-9 p-9 p-9 }\n" },
      },
    });
    const result = await upgrade({ cwd: dir, families: ["card"], source });
    expect(result.skillPath).not.toBeNull();
    const after = readFileSync(skillPath, "utf8");
    expect(after).not.toBe(before);
  });
});

describe("verify", () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("passes for a clean install", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    const result = await verify({ cwd: dir });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("catches manually-edited fingerprint headers (forged sha)", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    const cardPath = path.join(dir, "recipes", "card.css");
    const current = readFileSync(cardPath, "utf8");
    // tamper with body but rewrite header sha to claim the OLD value
    const tampered = rewriteHeaderSha(current + "\n/* hidden */\n", extractHeader(current)!.sha);
    writeFileSync(cardPath, tampered);
    const result = await verify({ cwd: dir });
    expect(result.ok).toBe(false);
    const headerIssue = result.issues.find((i) => i.kind === "header-tampered");
    expect(headerIssue).toBeTruthy();
  });

  it("catches body edits that don't update the header", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    const cardPath = path.join(dir, "recipes", "card.css");
    writeFileSync(cardPath, readFileSync(cardPath, "utf8") + "\n/* mine */\n");
    const result = await verify({ cwd: dir });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.kind === "header-tampered")).toBe(true);
  });

  it("notices missing recipe files referenced by lockfile", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    await rm(path.join(dir, "recipes", "card.css"));
    const result = await verify({ cwd: dir });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.kind === "missing-file" && i.family === "card")).toBe(true);
  });

  it("reports a legacy 6-hex seal as legacy-fingerprint, not tampered (#42 migration)", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    const cardPath = path.join(dir, "recipes", "card.css");
    // simulate a project sealed by the old CLI: a real-looking 6-hex header sha,
    // body otherwise untouched.
    const legacy = rewriteHeaderSha(readFileSync(cardPath, "utf8"), "abc123");
    writeFileSync(cardPath, legacy);
    const result = await verify({ cwd: dir });
    expect(result.ok).toBe(false);
    const issue = result.issues.find((i) => i.family === "card");
    expect(issue?.kind).toBe("legacy-fingerprint");
    // must NOT be misreported as tampering
    expect(result.issues.some((i) => i.kind === "header-tampered")).toBe(false);
  });
});
