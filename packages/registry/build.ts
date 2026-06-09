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
//   /* shortwind: <family>@<version> sha:<16 lowercase hex> */
// We deliberately do NOT accept legacy "— DO NOT EDIT THIS LINE" trailers,
// because writeFamily never emits them — accepting them silently round-trips
// the header into the short form.
// 6 hex (24 bits) is also accepted as the historical placeholder shape
// (e.g. `sha:000000` in source recipes); writeFamily always emits 16 hex.
const HEADER_RE =
  /^\/\*\s*shortwind:\s+(\S+)@(\S+)\s+sha:(?:[0-9a-f]{6}|[0-9a-f]{16})\s*\*\//;

function normalizeBody(body: string): string {
  // Two recipes that differ only in whether the file ends with `\n` should
  // hash identically — the writer always re-emits with a trailing newline, so
  // strip them all before hashing.
  return body
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/g, "");
}

function computeSha(body: string): string {
  // 16 hex chars = 64 bits of collision resistance. Long enough that
  // accidental fingerprint collisions across recipe edits are effectively
  // impossible while staying readable in the file header.
  return createHash("sha256").update(normalizeBody(body)).digest("hex").slice(0, 16);
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
  if (hdr) return hdr.version;
  // Per CLAUDE.md, family versions are mandatory and machine-checked. Surface
  // the fallback rather than letting a stray new recipe quietly ship as 0.0.1.
  console.warn(
    `[registry] family "${family}" has no .version file and no header — defaulting to 0.0.1. Add a header (\`/* shortwind: ${family}@<version> sha:... */\`) to make this explicit.`,
  );
  return "0.0.1";
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
  // Flat + versioned copies feed the catalog site and direct-CDN installs.
  writeFileSync(path.join(destDir, `${family}.css`), ensureNewline);
  writeFileSync(path.join(destDir, `${family}@${version}.css`), ensureNewline);
  // `recipes/<family>.css` is the path the CLI's registry source fetches
  // (mirrors the local file layout). Without it `shortwind add/init` 404s.
  const recipesDir = path.join(destDir, "recipes");
  mkdirSync(recipesDir, { recursive: true });
  writeFileSync(path.join(recipesDir, `${family}.css`), ensureNewline);
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

// Sort keys explicitly so output is reproducible across V8 versions and across
// any code path that builds the manifest by mutating objects (which can defeat
// V8's insertion-order guarantee for integer-like keys).
function stableStringify(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = sortKeys((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
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
    // Defense-in-depth: readdirSync returns basenames so a traversal payload
    // would have to be planted by a hostile filesystem, but we still refuse to
    // path.join() anything that escapes the recipes dir or contains separators.
    if (
      family.length === 0 ||
      family.includes("/") ||
      family.includes("\\") ||
      family.includes("..") ||
      family.startsWith(".")
    ) {
      throw new Error(`refusing to build recipe with unsafe family name ${JSON.stringify(family)} (from ${file})`);
    }
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

  // `index.json` is the family list the CLI fetches via listAllFamilies().
  // manifest.json carries the same names plus expansions for the catalog UI;
  // index.json is the slim contract the `--registry <url>` HTTP source reads.
  writeFileSync(
    path.join(registryOut, "index.json"),
    stableStringify({ families: families.map((f) => f.name) }),
  );

  if (!existsSync(opts.presetsFile)) {
    throw new Error(
      `presets file missing at ${opts.presetsFile} — registries must ship a presets.json (use {} for an empty map)`,
    );
  }
  copyFileSync(opts.presetsFile, path.join(registryOut, "presets.json"));

  validateExpansionTokens(manifest);
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

// Tokens are concatenated into `className` in the catalog UI. React escapes
// attribute values, so this is defense-in-depth rather than a live XSS fix —
// but it ensures a third-party recipe can't sneak `" onload="alert(1)` into
// the wire format that downstream tools also consume. Tailwind utilities
// (including arbitrary values like `bg-[url('/x.png')]`) stay within this
// alphabet; anything outside it is almost certainly a parsing bug or an
// attempted injection.
const EXPANSION_TOKEN_RE = /^[\w:\/\-\[\]\(\),.%@!#*+&'"=?]+$/;

function validateExpansionTokens(manifest: Manifest): void {
  for (const family of manifest.families) {
    for (const recipe of family.recipes) {
      for (const token of recipe.expansion) {
        if (!EXPANSION_TOKEN_RE.test(token)) {
          throw new Error(
            `family "${family.name}" recipe "${recipe.name}" emits invalid token ${JSON.stringify(token)} — must match ${EXPANSION_TOKEN_RE}`,
          );
        }
      }
    }
  }
}

function validatePresets(manifest: Manifest, presetsPath: string): void {
  const familyNames = new Set(manifest.families.map((f) => f.name));
  const raw: unknown = JSON.parse(readFileSync(presetsPath, "utf8"));
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${presetsPath}: presets.json must be a JSON object`);
  }
  for (const [preset, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry === "*") continue;
    if (!Array.isArray(entry)) {
      throw new Error(
        `${presetsPath}: preset "${preset}" must be "*" or an array of family names`,
      );
    }
    for (const family of entry) {
      if (typeof family !== "string") {
        throw new Error(
          `${presetsPath}: preset "${preset}" contains a non-string entry ${JSON.stringify(family)}`,
        );
      }
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
