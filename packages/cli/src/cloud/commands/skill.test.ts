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
import {
  loadHomePalette,
  renderCloudSkill,
  renderCloudSkillFiles,
  renderRecipesReference,
  runSkill,
} from "./skill.js";
import { homePaths, type ResolvedHome } from "../../home.js";

/**
 * skill tests — goldens for every file in the SKILL directory against a FIXED
 * palette (stable bytes), plus the IO shell loading a home's recipes/ and
 * writing to --out. SKILL.md is palette-independent by design; only
 * references/recipes.md reflects the account's vocabulary.
 */

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(DIR, "__fixtures__");

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

describe("renderCloudSkillFiles — golden", () => {
  it("renders SKILL.md + both references, byte-stable", () => {
    for (const file of renderCloudSkillFiles(FIXED_REGISTRY)) {
      const golden = path.join(FIXTURES, file.relativePath.replace("references/", "reference-"));
      // Refresh the golden on first run (or when UPDATE_GOLDEN=1), assert after.
      if (!existsSync(golden) || process.env["UPDATE_GOLDEN"] === "1") {
        writeFileSync(golden, file.contents);
      }
      expect(file.contents).toBe(readFileSync(golden, "utf8"));
    }
  });

  it("emits SKILL.md first, with the references below it", () => {
    const files = renderCloudSkillFiles(FIXED_REGISTRY);
    expect(files.map((f) => f.relativePath)).toEqual([
      "SKILL.md",
      "references/publishing.md",
      "references/recipes.md",
    ]);
  });

  it("has exactly one frontmatter block, on SKILL.md only", () => {
    const files = renderCloudSkillFiles(FIXED_REGISTRY);
    expect(files[0]?.contents.startsWith("---\nname: shortwind-cloud\n")).toBe(true);
    // Core's `---\nname: shortwind\n` is stripped out of the palette reference.
    for (const file of files.slice(1)) expect(file.contents.startsWith("---")).toBe(false);
    expect(files[2]?.contents).not.toContain("name: shortwind\n");
  });
});

describe("renderCloudSkill (SKILL.md)", () => {
  it("lists every cloud verb the CLI actually ships", () => {
    const out = renderCloudSkill();
    for (const verb of [
      "find",
      "publish",
      "update",
      "get",
      "delete",
      "visibility",
      "whoami",
      "login",
      "init-global",
      "domains",
      "bind-domain",
      "approve-domain",
    ]) {
      expect(out).toContain(`shortwind cloud ${verb}`);
    }
  });

  it("teaches a PATH-independent fallback and no machine-specific path", () => {
    const out = renderCloudSkill();
    expect(out).toContain("npx -y @shortwind/cli cloud");
    expect(out).toContain("command not found");
    // A hardcoded bin dir would be one user's setup baked into everyone's skill.
    expect(out).not.toMatch(/\/(usr\/local|opt\/homebrew|Library\/pnpm)\b/);
  });

  it("points at both references without inlining them", () => {
    const out = renderCloudSkill();
    expect(out).toContain("references/publishing.md");
    expect(out).toContain("references/recipes.md");
    expect(out).not.toContain("## Available recipes");
  });

  it("never tells an agent to re-login with a single scope", () => {
    // `--scope` REPLACES the grant (login.ts), so `login --scope domains:bind`
    // silently drops pages:read/pages:write and 403s every later publish.
    // bind-domain steps up on its own, so the advice was wrong AND unnecessary.
    for (const doc of renderCloudSkillFiles(FIXED_REGISTRY)) {
      expect(doc.contents).not.toMatch(/login\s+--scope\s+domains:bind(?!\s+--scope)/);
    }
  });

  it("is palette-independent, so an empty home never reads as 'cannot publish'", () => {
    // Same bytes for every account: the SKILL takes no Registry at all.
    expect(renderCloudSkill()).toContain("no Shortwind recipes required");
    expect(renderCloudSkill()).not.toContain("No families installed yet");
  });
});

describe("renderRecipesReference", () => {
  it("frames the palette as optional and lists the installed names", () => {
    const out = renderRecipesReference(FIXED_REGISTRY);
    expect(out).toContain("optional");
    expect(out).toContain("@card");
    expect(out).toContain("@btn");
  });

  it("still renders for an empty palette", () => {
    const out = renderRecipesReference({ flattened: {}, families: {} });
    expect(out).toContain("No families installed yet");
    expect(out).toContain("required in order to publish");
  });
});

describe("loadHomePalette + runSkill (IO)", () => {
  it("returns an empty registry when recipes/ is absent", () => {
    const reg = loadHomePalette(path.join(tmpdir(), "definitely-not-here-xyz"));
    expect(reg).toEqual({ flattened: {}, families: {} });
  });

  it("loads recipes from a home dir and writes the SKILL directory to --out", () => {
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
      expect(readFileSync(outPath, "utf8")).toBe(md.endsWith("\n") ? md : md + "\n");
      expect(md).toContain("## Verbs");

      // The references land BESIDE the SKILL, and carry the home's palette.
      const recipesRef = path.join(root, "references", "recipes.md");
      expect(existsSync(path.join(root, "references", "publishing.md"))).toBe(true);
      expect(readFileSync(recipesRef, "utf8")).toContain("## Available recipes");
      // The palette listing belongs to the reference, not to the always-loaded
      // SKILL (which names `@card` only as an illustration).
      expect(md).not.toContain("## Available recipes");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
