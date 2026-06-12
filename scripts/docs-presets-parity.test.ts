import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #77: cli.md shipped preset names (`minimal`, `marketing`, `dashboard`) that
// never existed — "the first command you run, so it dents trust immediately."
// Every preset name the docs mention must resolve against the registry's
// presets.json, so the docs can't drift from the CLI again.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function registryPresetNames(): Set<string> {
  const presets = JSON.parse(
    readFileSync(path.join(root, "packages", "registry", "presets.json"), "utf8"),
  ) as Record<string, unknown>;
  // `none` is an init-only sentinel handled by the CLI, not a registry entry.
  return new Set([...Object.keys(presets), "none"]);
}

// Backticked names in any sentence that talks about presets, plus every
// literal `--preset <name>` usage, across all docs pages.
function documentedPresetNames(): { file: string; name: string }[] {
  const docsDir = path.join(root, "site", "src", "content", "docs");
  const out: { file: string; name: string }[] = [];
  for (const file of readdirSync(docsDir).filter((f) => f.endsWith(".md"))) {
    const body = readFileSync(path.join(docsDir, file), "utf8");
    for (const line of body.split("\n")) {
      if (/--preset\s+`?([a-z-]+)`?/.test(line)) {
        const m = line.match(/--preset\s+`?([a-z-]+)`?/);
        // `--preset <name>` placeholders aren't a concrete preset.
        if (m && m[1] && m[1] !== "name") out.push({ file, name: m[1] });
      }
      if (/\bpresets?\b/i.test(line)) {
        for (const m of line.matchAll(/`([a-z][a-z-]*)`/g)) {
          out.push({ file, name: m[1] ?? "" });
        }
      }
    }
  }
  return out;
}

// Backticked words near the word "preset" that aren't preset names at all
// (flags, commands); keep this list short and explicit.
const NON_PRESET_MENTIONS = new Set(["--yes", "-y", "shortwind", "preset", "init"]);

describe("docs preset parity (#77)", () => {
  it("every preset name the docs mention exists in the registry", () => {
    const real = registryPresetNames();
    const unknown = documentedPresetNames().filter(
      ({ name }) => !real.has(name) && !NON_PRESET_MENTIONS.has(name),
    );
    expect(unknown, JSON.stringify(unknown)).toEqual([]);
  });

  it("the cli.md preset section lists the real presets", () => {
    const body = readFileSync(
      path.join(root, "site", "src", "content", "docs", "cli.md"),
      "utf8",
    );
    for (const name of ["starter", "app", "content", "all"]) {
      expect(body).toContain(`\`${name}\``);
    }
  });
});
