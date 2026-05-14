import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lint, formatFindingsText } from "../src/commands/lint.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const RECIPES_SRC = path.resolve(here, "..", "..", "registry", "recipes");

async function setupProject(families: string[] = ["card"]): Promise<string> {
  const raw = await mkdtemp(path.join(tmpdir(), "shortwind-lint-"));
  const dir = realpathSync(raw);
  const recipesDir = path.join(dir, "recipes");
  await mkdir(recipesDir, { recursive: true });
  for (const fam of families) {
    await copyFile(path.join(RECIPES_SRC, `${fam}.css`), path.join(recipesDir, `${fam}.css`));
  }
  await writeFile(
    path.join(dir, "shortwind.config.json"),
    JSON.stringify({ recipesDir: "recipes", outputPath: "SKILL.md" }, null, 2),
  );
  return dir;
}

async function writeSource(dir: string, rel: string, body: string): Promise<string> {
  const full = path.join(dir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
  return full;
}

describe("lint", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("flags unknown @-recipe references", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await writeSource(dir, "src/page.tsx", `export default () => <div class="@ghost p-2" />;\n`);

    const result = await lint({ cwd: dir });
    const unknown = result.findings.filter((f) => f.rule === "recipe/unknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.message).toContain("@ghost");
    expect(result.ok).toBe(false);
  });

  it("flags unused recipes", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await writeSource(dir, "src/page.tsx", `export default () => <div className="@card" />;\n`);

    const result = await lint({ cwd: dir, rules: ["recipe/unused"] });
    const unused = result.findings.filter((f) => f.rule === "recipe/unused");
    expect(unused.length).toBeGreaterThan(0);
    expect(unused.every((f) => f.severity === "info")).toBe(true);
    expect(unused.map((f) => f.message).some((m) => m.includes("@card-flat"))).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("flags redundant utilities already included by a recipe on the same element", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await writeSource(
      dir,
      "src/page.tsx",
      `export default () => <div className="@card rounded-lg p-4" />;\n`,
    );

    const result = await lint({ cwd: dir, rules: ["recipe/no-redundant-utility"] });
    const redundant = result.findings.filter((f) => f.rule === "recipe/no-redundant-utility");
    const messages = redundant.map((f) => f.message).join("\n");
    expect(messages).toContain("rounded-lg");
    expect(messages).toContain("p-4");
  });

  it("auto-fixes redundant utilities idempotently", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    const file = await writeSource(
      dir,
      "src/page.tsx",
      `export default () => <div className="@card rounded-lg p-4 shadow" />;\n`,
    );

    const first = await lint({ cwd: dir, rules: ["recipe/no-redundant-utility"], fix: true });
    expect(first.filesFixed).toContain(file);
    const after = await readFile(file, "utf8");
    expect(after).toContain('className="@card shadow"');
    expect(after).not.toContain("rounded-lg");

    const second = await lint({ cwd: dir, rules: ["recipe/no-redundant-utility"], fix: true });
    expect(second.filesFixed).toEqual([]);
    expect(await readFile(file, "utf8")).toBe(after);
  });

  it("surfaces duplicate-recipe diagnostics from the registry", async () => {
    const dir = await setupProject([]);
    dirs.push(dir);
    const recipesDir = path.join(dir, "recipes");
    await writeFile(
      path.join(recipesDir, "alpha.css"),
      `/* shortwind: alpha@0.0.1 sha:000000 */\n@recipe widget {\n  p-2\n}\n`,
    );
    await writeFile(
      path.join(recipesDir, "beta.css"),
      `/* shortwind: beta@0.0.1 sha:000000 */\n@recipe widget {\n  p-3\n}\n`,
    );

    const result = await lint({ cwd: dir, rules: ["recipe/duplicate"] });
    const dups = result.findings.filter((f) => f.rule === "recipe/duplicate");
    expect(dups.length).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
  });

  it("formatFindingsText emits eslint-compatible lines", () => {
    const text = formatFindingsText([
      {
        rule: "recipe/unknown",
        severity: "error",
        file: "/x/src/page.tsx",
        line: 1,
        column: 20,
        message: "unknown recipe @ghost",
      },
    ]);
    expect(text).toBe(
      "/x/src/page.tsx:1:20 error  unknown recipe @ghost  [recipe/unknown]",
    );
  });
});
