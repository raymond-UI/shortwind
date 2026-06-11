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

  it("preserves a ${...} dynamic token through --fix (#50)", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    const file = await writeSource(
      dir,
      "src/page.html",
      `<div class="@card \${cls} rounded-lg p-4"></div>\n`,
    );
    await lint({ cwd: dir, rules: ["recipe/no-redundant-utility"], fix: true });
    const after = await readFile(file, "utf8");
    // rounded-lg + p-4 are redundant (in @card) and removed; ${cls} survives.
    expect(after).toContain("${cls}");
    expect(after).toContain(`class="@card \${cls}"`);
    expect(after).not.toMatch(/rounded-lg|p-4/);
  });

  it("leaves a clean class attribute (recipe, no redundancy) byte-identical incl. whitespace (#50)", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    const original = `<div class="@card\n  shadow\n  ring-2"></div>\n`;
    const file = await writeSource(dir, "src/page.html", original);
    const result = await lint({ cwd: dir, rules: ["recipe/no-redundant-utility"], fix: true });
    // nothing redundant → no rewrite, interior newlines preserved
    expect(result.filesFixed).toEqual([]);
    expect(await readFile(file, "utf8")).toBe(original);
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

  it("warns when recipe names put size before intent", async () => {
    const dir = await setupProject([]);
    dirs.push(dir);
    await writeFile(
      path.join(dir, "recipes", "button.css"),
      `/* shortwind: button@0.0.1 sha:000000 */\n@recipe btn-lg-primary {\n  px-4 py-2\n}\n`,
    );

    const result = await lint({ cwd: dir, rules: ["recipe/bad-suffix-order"] });
    const badOrder = result.findings.filter((f) => f.rule === "recipe/bad-suffix-order");
    expect(badOrder).toHaveLength(1);
    expect(badOrder[0]!.severity).toBe("warning");
    expect(badOrder[0]!.message).toContain("@btn-primary-lg");
    expect(result.ok).toBe(true);
  });

  it("warns when one element combines conflicting recipe intents", async () => {
    const dir = await setupProject(["button"]);
    dirs.push(dir);
    await writeSource(
      dir,
      "src/page.tsx",
      `export default () => <button className="@btn-primary @btn-danger" />;\n`,
    );

    const result = await lint({ cwd: dir, rules: ["recipe/conflicting-intent"] });
    const conflicts = result.findings.filter((f) => f.rule === "recipe/conflicting-intent");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.severity).toBe("warning");
    expect(conflicts[0]!.message).toContain("@btn-danger");
    expect(conflicts[0]!.message).toContain("@btn-primary");
    expect(result.ok).toBe(true);
  });

  it("handles conflicting intents for renamed hyphenated families", async () => {
    const dir = await setupProject([]);
    dirs.push(dir);
    await writeFile(
      path.join(dir, "recipes", "marketing-card.css"),
      [
        `/* shortwind: marketing-card@0.0.1 sha:000000 */`,
        `@recipe marketing-card-primary { p-4 }`,
        `@recipe marketing-card-danger { p-4 }`,
        ``,
      ].join("\n"),
    );
    await writeSource(
      dir,
      "src/page.tsx",
      `export default () => <div className="@marketing-card-primary @marketing-card-danger" />;\n`,
    );

    const result = await lint({ cwd: dir, rules: ["recipe/conflicting-intent"] });
    const conflicts = result.findings.filter((f) => f.rule === "recipe/conflicting-intent");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.message).toContain("multiple marketing-card intents");
    expect(conflicts[0]!.message).toContain("@marketing-card-danger");
    expect(result.ok).toBe(true);
  });

  it("detects @-recipes inside JSX className={...} expressions (string literal, clsx, template literal)", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await writeSource(
      dir,
      "src/page.tsx",
      [
        `import clsx from "clsx";`,
        `export const A = () => <div className={"@ghost"} />;`,
        `export const B = ({ on }: { on: boolean }) => <div className={clsx("@phantom", on && "@card")} />;`,
        `export const C = ({ k }: { k: string }) => <div className={` + "`@spectre ${k}`" + `} />;`,
        ``,
      ].join("\n"),
    );

    const result = await lint({ cwd: dir, rules: ["recipe/unknown"] });
    const unknown = result.findings.filter((f) => f.rule === "recipe/unknown").map((f) => f.message);
    expect(unknown).toEqual(
      expect.arrayContaining([
        expect.stringContaining("@ghost"),
        expect.stringContaining("@phantom"),
        expect.stringContaining("@spectre"),
      ]),
    );
  });

  it("counts @-recipes inside className={...} as used (recipe/unused)", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await writeSource(
      dir,
      "src/page.tsx",
      `import clsx from "clsx";\nexport default () => <div className={clsx("@card")} />;\n`,
    );

    const result = await lint({ cwd: dir, rules: ["recipe/unused"] });
    const unused = result.findings.filter((f) => f.rule === "recipe/unused").map((f) => f.message);
    expect(unused.some((m) => m.includes("@card "))).toBe(false);
  });

  it("counts @-recipes inside cva()/tv() calls as used (matches the build transform)", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    // @card and @card-flat are referenced only from a cva() call, never a
    // className. The build expands these; lint must not call them unused.
    await writeSource(
      dir,
      "src/button.ts",
      `import { cva } from "class-variance-authority";\n` +
        `export const card = cva("@card", {\n` +
        `  variants: { tone: { ghost: "@card-flat" } },\n` +
        `});\n`,
    );

    const result = await lint({ cwd: dir, rules: ["recipe/unused"] });
    const unused = result.findings.filter((f) => f.rule === "recipe/unused").map((f) => f.message);
    expect(unused.some((m) => m.includes("@card "))).toBe(false);
    expect(unused.some((m) => m.includes("@card-flat"))).toBe(false);
  });

  it("does NOT rewrite JSX className={...} during --fix (only reports)", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    const original = `import clsx from "clsx";\nexport default () => <div className={clsx("@card rounded-lg p-4")} />;\n`;
    const file = await writeSource(dir, "src/page.tsx", original);

    const result = await lint({ cwd: dir, rules: ["recipe/no-redundant-utility"], fix: true });
    const redundant = result.findings.filter((f) => f.rule === "recipe/no-redundant-utility");
    expect(redundant.length).toBeGreaterThan(0);
    expect(result.filesFixed).not.toContain(file);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("warns when multiple recipes from the same family appear on one element", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await writeSource(
      dir,
      "src/page.tsx",
      `export default () => <div className="@card @card-elevated" />;\n`,
    );

    const result = await lint({ cwd: dir, rules: ["recipe/no-sibling-overlap"] });
    const overlaps = result.findings.filter((f) => f.rule === "recipe/no-sibling-overlap");
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.severity).toBe("warning");
    expect(overlaps[0]!.message).toContain("card");
    expect(overlaps[0]!.message).toContain("@card-elevated");
    expect(result.ok).toBe(true);
  });

  it("does not flag a single recipe from a family as overlapping", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await writeSource(
      dir,
      "src/page.tsx",
      `export default () => <div className="@card p-4" />;\n`,
    );

    const result = await lint({ cwd: dir, rules: ["recipe/no-sibling-overlap"] });
    const overlaps = result.findings.filter((f) => f.rule === "recipe/no-sibling-overlap");
    expect(overlaps).toEqual([]);
  });

  it("warns on dynamic recipe names inside template literals", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await writeSource(
      dir,
      "src/page.tsx",
      [
        `export const View = ({ variant, size }: { variant: string; size: string }) => (`,
        "  <div className={`@${variant} @card-${size}`} />",
        `);`,
        ``,
      ].join("\n"),
    );

    const result = await lint({ cwd: dir, rules: ["recipe/dynamic-class"] });
    const dynamics = result.findings.filter((f) => f.rule === "recipe/dynamic-class");
    expect(dynamics.length).toBe(2);
    expect(dynamics.every((f) => f.severity === "warning")).toBe(true);
    const messages = dynamics.map((f) => f.message).join("\n");
    expect(messages).toContain("@${variant}");
    expect(messages).toContain("@card-${size}");
    expect(result.ok).toBe(true);
  });

  it("does not flag interpolations without an @ prefix as dynamic recipes", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await writeSource(
      dir,
      "src/page.tsx",
      [
        `export const View = ({ extra }: { extra: string }) => (`,
        "  <div className={`@card ${extra}`} />",
        `);`,
        ``,
      ].join("\n"),
    );

    const result = await lint({ cwd: dir, rules: ["recipe/dynamic-class"] });
    expect(result.findings.filter((f) => f.rule === "recipe/dynamic-class")).toEqual([]);
  });

  it("flags a recipe whose name collides with a reserved Tailwind @-utility", async () => {
    const dir = await setupProject([]);
    dirs.push(dir);
    await writeFile(
      path.join(dir, "recipes", "surface.css"),
      `/* shortwind: surface@0.0.1 sha:000000 */\n@recipe container { mx-auto max-w-6xl }\n`,
    );

    const result = await lint({ cwd: dir, rules: ["recipe/reserved-name"] });
    const reserved = result.findings.filter((f) => f.rule === "recipe/reserved-name");
    expect(reserved).toHaveLength(1);
    expect(reserved[0]!.severity).toBe("error");
    expect(reserved[0]!.message).toContain("@container");
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
