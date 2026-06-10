import {
  copyFileSync,
  cpSync,
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
import { buildRegistry, parseRecipeFile, RESERVED_RECIPE_NAMES } from "@shortwind/core";
import type { Recipe, Registry } from "@shortwind/core";

export type BuildOptions = {
  recipesDir: string;
  presetsFile: string;
  changelogsDir: string;
  runtimeBundle: string | null;
  runtimeVersion: string;
  outDir: string;
  // Path to the committed version ledger. When set, the build fails if a
  // family's content changed without a version bump (and updates the ledger
  // when a bump is legitimate). Omit to skip the check (e.g. in unit tests).
  versionLockPath?: string;
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

type VersionLedger = Record<string, { version: string; sha: string }>;

// Fail the build if a family's body changed but its version header didn't —
// the exact mistake that shipped a renamed recipe under an unchanged version
// and broke `shortwind upgrade`. The ledger records the last {version, sha}
// per family; a legitimate version bump updates it.
function enforceVersionBumps(
  families: Array<{ family: string; version: string; sha: string }>,
  lockPath: string,
): void {
  const ledger: VersionLedger = existsSync(lockPath)
    ? (JSON.parse(readFileSync(lockPath, "utf8")) as VersionLedger)
    : {};

  const violations: string[] = [];
  const next: VersionLedger = {};
  for (const { family, version, sha } of families) {
    const prev = ledger[family];
    if (prev && prev.sha !== sha && prev.version === version) {
      violations.push(
        `  ${family}: content changed but version is still ${version} — bump the @<version> in ${family}.css's header`,
      );
    }
    next[family] = { version, sha };
  }

  if (violations.length > 0) {
    throw new Error(`Family content changed without a version bump:\n${violations.join("\n")}`);
  }

  // Keep the ledger in sync (sorted for stable diffs).
  const sorted: VersionLedger = {};
  for (const k of Object.keys(next).sort()) sorted[k] = next[k]!;
  writeFileSync(lockPath, JSON.stringify(sorted, null, 2) + "\n");
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
    for (const r of parsed.value.recipes) {
      // `@`-prefixed recipe names share a namespace with Tailwind's own
      // `@`-utilities. A recipe named after one (e.g. `container`, which is
      // Tailwind v4's container-query utility) silently shadows it, so the
      // catalog must never ship one.
      if (RESERVED_RECIPE_NAMES.has(r.name)) {
        throw new Error(
          `recipe "@${r.name}" (in ${file}) collides with a reserved Tailwind @-utility — rename it`,
        );
      }
      allRecipes.push(r);
    }
  }

  if (opts.versionLockPath) {
    enforceVersionBumps(familySources, opts.versionLockPath);
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
  // Primary output is this package's own dist (what `@shortwind/catalog`
  // publishes to npm). The pipeline writes everything under `<outDir>/registry`.
  const distDir = path.join(here, "dist");
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
    outDir: distDir,
    runtimeBundle,
    runtimeVersion,
    versionLockPath: path.join(here, "catalog.lock.json"),
  });

  // Mirror into the web app's public dir so the site can still serve/browse the
  // catalog. (Once the CLI defaults to the package, the HTTP endpoint is only
  // for the catalog browser / BYO reference — see issue #33.)
  const webRegistry = path.resolve(here, "..", "..", "apps", "web", "public", "registry");
  rmSync(webRegistry, { recursive: true, force: true });
  cpSync(path.join(distDir, "registry"), webRegistry, { recursive: true });

  console.log(
    `[catalog] wrote ${result.manifest.families.length} families to ${result.manifestPath} (+ mirrored to apps/web/public/registry)`,
  );
}
