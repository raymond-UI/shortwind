import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Registry } from "@shortwind/core";
import { loadHomePalette, renderCloudSkill, runSkill } from "./skill.js";
import { homePaths, type ResolvedHome } from "../../home.js";

/**
 * skill tests — golden SKILL.md for a FIXED palette (stable bytes), plus the
 * IO shell loading a home's recipes/ and writing to --out. The cloud-verbs
 * section is fixed; the palette section reflects the account's vocabulary.
 */

const DIR = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(DIR, "__fixtures__", "skill.golden.md");

// A deliberately small, fixed registry: two families so the palette section is
// non-trivial but byte-stable. Mirrors the cloud-vocabulary discovery (§5.7).
const FIXED_REGISTRY: Registry = {
  flattened: {
    "card": ["rounded-lg", "border", "bg-white", "p-4"],
    "card-elevated": ["rounded-lg", "border", "bg-white", "p-4", "shadow-md"],
    "btn": ["inline-flex", "items-center", "px-4", "py-2", "rounded-md"],
  },
  families: {
    card: [
      {
        name: "card",
        description: null,
        tokens: ["rounded-lg", "border", "bg-white", "p-4"],
        references: [],
        sourceFile: "card.css",
        sourceLine: 1,
      },
      {
        name: "card-elevated",
        description: null,
        tokens: ["shadow-md"],
        references: ["card"],
        sourceFile: "card.css",
        sourceLine: 5,
      },
    ],
    button: [
      {
        name: "btn",
        description: null,
        tokens: ["inline-flex", "items-center", "px-4", "py-2", "rounded-md"],
        references: [],
        sourceFile: "button.css",
        sourceLine: 1,
      },
    ],
  },
};

describe("renderCloudSkill — golden", () => {
  it("renders cloud verbs + the account's recipe palette, byte-stable", () => {
    const out = renderCloudSkill(FIXED_REGISTRY);

    // Refresh the golden on first run (or when UPDATE_GOLDEN=1), assert after.
    if (!existsSync(GOLDEN) || process.env["UPDATE_GOLDEN"] === "1") {
      writeFileSync(GOLDEN, out);
    }
    expect(out).toBe(readFileSync(GOLDEN, "utf8"));
  });

  it("has exactly one frontmatter block (core's palette frontmatter is stripped)", () => {
    const out = renderCloudSkill(FIXED_REGISTRY);
    expect(out.startsWith("---\nname: shortwind-cloud\n")).toBe(true);
    // Only the leading fence pair — core's `---\nname: shortwind\n` is gone.
    expect(out).not.toContain("name: shortwind\n");
  });

  it("lists every cloud verb and every recipe in the palette", () => {
    const out = renderCloudSkill(FIXED_REGISTRY);
    for (const verb of ["find", "publish", "update", "get", "delete", "visibility", "bind-domain"]) {
      expect(out).toContain(`shortwind cloud ${verb}`);
    }
    expect(out).toContain("@card");
    expect(out).toContain("@btn");
    expect(out).toContain("## Recipe palette");
  });
});

describe("renderCloudSkill — empty palette", () => {
  it("still advertises the verbs and notes no recipes installed", () => {
    const out = renderCloudSkill({ flattened: {}, families: {} });
    expect(out).toContain("## Verbs");
    expect(out).toContain("shortwind cloud publish");
    expect(out).toContain("No families installed yet");
  });
});

describe("loadHomePalette + runSkill (IO)", () => {
  it("returns an empty registry when recipes/ is absent", () => {
    const reg = loadHomePalette(path.join(tmpdir(), "definitely-not-here-xyz"));
    expect(reg).toEqual({ flattened: {}, families: {} });
  });

  it("loads recipes from a home dir and writes SKILL.md to --out", () => {
    const root = mkdtempSync(path.join(tmpdir(), "swc-skill-"));
    try {
      const paths = homePaths(root);
      const recipesDir = paths.recipesDir;
      const home: ResolvedHome = { kind: "global", ...paths };
      // Write one recipe family into the home palette (real @recipe syntax).
      mkdirSync(recipesDir, { recursive: true });
      writeFileSync(
        path.join(recipesDir, "card.css"),
        "/* shortwind: card@0.0.1 sha:000000 */\n@recipe card {\n  rounded-lg border p-4\n}\n",
      );

      const reg = loadHomePalette(recipesDir);
      expect(Object.keys(reg.flattened)).toContain("card");

      const outPath = path.join(root, "SKILL.md");
      const md = runSkill({ out: outPath }, home);
      expect(existsSync(outPath)).toBe(true);
      expect(readFileSync(outPath, "utf8")).toBe(md.endsWith("\n") ? md : md + "\n");
      expect(md).toContain("@card");
      expect(md).toContain("## Verbs");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
