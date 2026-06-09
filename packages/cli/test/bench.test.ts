import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bench, formatBenchTable } from "../src/commands/bench.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const RECIPES_SRC = path.resolve(here, "..", "..", "registry", "recipes");

async function setupProject(families: string[] = ["card", "button"]): Promise<string> {
  const raw = await mkdtemp(path.join(tmpdir(), "shortwind-bench-"));
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

describe("bench", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("successfully runs on the built-in corpus", async () => {
    const result = await bench({ cwd: process.cwd(), corpus: true });
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.totals.compactClassTokens).toBeGreaterThan(0);
    expect(result.totals.expandedClassTokens).toBeGreaterThan(result.totals.compactClassTokens);
    expect(result.totals.compactClassBytes).toBeGreaterThan(0);
    expect(result.totals.expandedClassBytes).toBeGreaterThan(result.totals.compactClassBytes);
    expect(result.totals.compactLlmTokens).toBeGreaterThan(0);
    expect(result.totals.expandedLlmTokens).toBeGreaterThan(result.totals.compactLlmTokens);

    const buttonResult = result.files.find((f) => f.filename === "button.tsx");
    expect(buttonResult).toBeDefined();
    expect(buttonResult!.compactClassTokens).toBe(10); // 10 classes/recipes inside className attributes
    expect(buttonResult!.expandedClassTokens).toBeGreaterThan(10);
  });

  // Guards the README's headline "~50% fewer tokens" claim. The measured
  // figure is 58.2% whole-file token savings across the corpus; a 50% floor
  // catches a real regression (catalog drift, expander change) without
  // tripping on noise. If this fails, the README number is no longer honest —
  // fix the regression or update both together.
  it("holds the README token-savings claim (whole-file ≥ 50%)", async () => {
    const result = await bench({ cwd: process.cwd(), corpus: true });
    const { compactLlmTokens, expandedLlmTokens } = result.totals;
    const saved = 1 - compactLlmTokens / expandedLlmTokens;
    expect(saved).toBeGreaterThanOrEqual(0.5);
  });

  it("runs on a local project structure", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await writeSource(
      dir,
      "src/page.tsx",
      `export default () => (\n  <div className="@card p-2">\n    <h1 className="@card-header">Hello</h1>\n  </div>\n);\n`,
    );

    const result = await bench({ cwd: dir });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.filename).toBe("src/page.tsx");
    expect(result.files[0]!.compactClassTokens).toBe(3); // @card, p-2, @card-header
    expect(result.files[0]!.expandedClassTokens).toBeGreaterThan(3);
  });

  it("filters by target path/glob", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await writeSource(dir, "src/page.tsx", `<div className="@card" />`);
    await writeSource(dir, "src/other.tsx", `<div className="@card" />`);

    const result = await bench({ cwd: dir, path: "src/page.tsx" });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.filename).toBe("src/page.tsx");
  });

  it("formats output table correctly", async () => {
    const result = await bench({ cwd: process.cwd(), corpus: true });
    const table = formatBenchTable(result);
    expect(table).toContain("File");
    expect(table).toContain("Metric");
    expect(table).toContain("Shortwind");
    expect(table).toContain("Expanded");
    expect(table).toContain("Saved");
    expect(table).toContain("TOTAL");
    expect(table).toContain("Class Words");
    expect(table).toContain("Class Bytes");
    expect(table).toContain("File Tokens");
  });
});
