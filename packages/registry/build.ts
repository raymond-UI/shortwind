import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { buildRegistry, parseRecipeFile } from "@shortwind/core";
import type { Recipe, Registry } from "@shortwind/core";

export type BuildOptions = {
  recipesDir: string;
  presetsFile: string;
  changelogsDir: string;
  runtimeBundle: string | null;
  runtimeVersion: string;
  outDir: string;
};

export type ManifestFamily = {
  name: string;
  version: string;
  sha: string;
  recipes: Array<{
    name: string;
    description: string | null;
    expansion: string[];
  }>;
};

export type Manifest = {
  families: ManifestFamily[];
};

export type BuildResult = {
  manifest: Manifest;
  manifestPath: string;
};

// Canonical header form (matches writeFamily output exactly):
//   /* shortwind: <family>@<version> sha:<6 lowercase hex> */
// We deliberately do NOT accept legacy "— DO NOT EDIT THIS LINE" trailers,
// because writeFamily never emits them — accepting them silently round-trips
// the header into the short form. sha is validated to a 6-hex shape.
const HEADER_RE =
  /^\/\*\s*shortwind:\s+(\S+)@(\S+)\s+sha:([0-9a-f]{6})\s*\*\//;

function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
}

function computeSha(body: string): string {
  return createHash("sha256").update(normalizeBody(body)).digest("hex").slice(0, 6);
}

function parseHeader(source: string): { family: string; version: string } | null {
  const firstLine = source.split("\n", 1)[0] ?? "";
  const m = firstLine.match(HEADER_RE);
  if (!m) return null;
  return { family: m[1]!, version: m[2]! };
}

function bodyWithoutHeader(source: string): string {
  const lines = source.split("\n");
  if (lines[0] && HEADER_RE.test(lines[0])) {
    return lines.slice(1).join("\n");
  }
  return source;
}

function familyVersion(opts: BuildOptions, family: string, source: string): string {
  const versionFile = path.join(opts.recipesDir, `${family}.version`);
  if (existsSync(versionFile)) {
    return readFileSync(versionFile, "utf8").trim();
  }
  const hdr = parseHeader(source);
  return hdr?.version ?? "0.0.1";
}

function writeFamily(
  destDir: string,
  family: string,
  version: string,
  body: string,
  sha: string,
): void {
  const header = `/* shortwind: ${family}@${version} sha:${sha} */`;
  const out = `${header}\n${body}`;
  const ensureNewline = out.endsWith("\n") ? out : `${out}\n`;
  writeFileSync(path.join(destDir, `${family}.css`), ensureNewline);
  writeFileSync(path.join(destDir, `${family}@${version}.css`), ensureNewline);
}

function defaultChangelog(family: string, version: string): string {
  return `# ${family}\n\n## ${version}\n\nInitial release.\n`;
}

function copyChangelog(
  changelogsDir: string,
  family: string,
  version: string,
  outDir: string,
): void {
  const familyDir = path.join(outDir, family);
  mkdirSync(familyDir, { recursive: true });
  const src = path.join(changelogsDir, `${family}.md`);
  const dest = path.join(familyDir, "CHANGELOG.md");
  if (existsSync(src)) {
    copyFileSync(src, dest);
  } else {
    writeFileSync(dest, defaultChangelog(family, version));
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function ensureCleanDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

export function buildRegistryPipeline(opts: BuildOptions): BuildResult {
  const recipeFiles = readdirSync(opts.recipesDir)
    .filter((f) => f.endsWith(".css"))
    .sort();

  if (recipeFiles.length === 0) {
    throw new Error(`No recipe .css files found in ${opts.recipesDir}`);
  }

  const allRecipes: Recipe[] = [];
  const familySources: Array<{
    family: string;
    version: string;
    sha: string;
    body: string;
  }> = [];

  for (const file of recipeFiles) {
    const filePath = path.join(opts.recipesDir, file);
    const source = readFileSync(filePath, "utf8");
    const parsed = parseRecipeFile(source, file);
    if (!parsed.ok) {
      const messages = parsed.errors.map((e) => `  ${e.file}:${e.line} ${e.message}`).join("\n");
      throw new Error(`Failed to parse ${file}:\n${messages}`);
    }
    const family = file.replace(/\.css$/, "");
    const version = familyVersion(opts, family, source);
    const body = bodyWithoutHeader(source);
    const sha = computeSha(body);
    familySources.push({ family, version, sha, body });
    for (const r of parsed.value.recipes) allRecipes.push(r);
  }

  const built = buildRegistry(allRecipes);
  if (!built.ok) {
    const messages = built.errors.map((e) => `  ${e.file}:${e.line} ${e.message}`).join("\n");
    throw new Error(`Registry resolution failed:\n${messages}`);
  }

  const registry: Registry = built.value;

  const registryOut = path.join(opts.outDir, "registry");
  ensureCleanDir(registryOut);

  const families: ManifestFamily[] = [];
  for (const { family, version, sha, body } of familySources) {
    writeFamily(registryOut, family, version, body, sha);
    copyChangelog(opts.changelogsDir, family, version, registryOut);
    const recs = registry.families[family] ?? [];
    families.push({
      name: family,
      version,
      sha,
      recipes: recs.map((r) => ({
        name: r.name,
        description: r.description,
        expansion: registry.flattened[r.name] ?? [],
      })),
    });
  }

  families.sort((a, b) => a.name.localeCompare(b.name));
  const manifest: Manifest = { families };
  const manifestPath = path.join(registryOut, "manifest.json");
  writeFileSync(manifestPath, stableStringify(manifest));

  if (existsSync(opts.presetsFile)) {
    copyFileSync(opts.presetsFile, path.join(registryOut, "presets.json"));
  }

  validatePresets(manifest, path.join(registryOut, "presets.json"));

  if (opts.runtimeBundle && existsSync(opts.runtimeBundle)) {
    copyFileSync(opts.runtimeBundle, path.join(opts.outDir, "expand.js"));
    copyFileSync(
      opts.runtimeBundle,
      path.join(opts.outDir, `expand@${opts.runtimeVersion}.js`),
    );
  }

  return { manifest, manifestPath };
}

function validatePresets(manifest: Manifest, presetsPath: string): void {
  if (!existsSync(presetsPath)) return;
  const familyNames = new Set(manifest.families.map((f) => f.name));
  const raw = JSON.parse(readFileSync(presetsPath, "utf8")) as Record<string, string[] | "*">;
  for (const [preset, families] of Object.entries(raw)) {
    if (families === "*") continue;
    for (const family of families) {
      if (!familyNames.has(family)) {
        throw new Error(
          `preset "${preset}" references family "${family}" which is not in the manifest`,
        );
      }
    }
  }
}

const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const recipesDir = path.join(here, "recipes");
  const presetsFile = path.join(here, "presets.json");
  const changelogsDir = path.join(here, "changelogs");
  const outDir = path.resolve(here, "..", "..", "apps", "web", "public");
  const runtimeBundle = path.resolve(
    here,
    "..",
    "runtime",
    "dist",
    "expand.js",
  );
  const runtimeVersion = "0.0.1";

  const result = buildRegistryPipeline({
    recipesDir,
    presetsFile,
    changelogsDir,
    outDir,
    runtimeBundle,
    runtimeVersion,
  });

  console.log(
    `[registry] wrote ${result.manifest.families.length} families to ${result.manifestPath}`,
  );
}
