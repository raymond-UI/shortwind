import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { toArray, type StubResult } from "./stub.js";
import {
  resolveHome,
  readActiveAccount,
  readHomeLockfile,
  type ResolvedHome,
} from "../home.js";
import {
  selectTouchedRecipes,
  type CandidateRecipe,
} from "../../../shared/src/fingerprint.js";
import type { Lockfile } from "../../../shared/src/lockfile-diff.js";
import {
  ApiError,
  createApiClient,
  resolveBaseUrl,
  type ApiClient,
  type PublishPayload,
  type PublishResult,
  type RecipePayload,
} from "../api-client.js";

/**
 * `publish <file>` — POST /v1/pages: create a page from an HTML file
 * (+ lockfile, + touched recipes). Idempotency-keyed (PRD §4). Returns
 * id, url, version when implemented.
 *
 * `--tag` is repeatable; `--domain` sets the desired subdomain/slug;
 * `--visibility` mirrors the `visibility` verb's levels.
 *
 * {@link publish} is the retained CLOUD-04 parse stub (cli.test.ts). The REAL
 * behavior is split into testable units:
 *   - {@link assemblePublishPayload} — pure: HTML + lockfile + ONLY the touched
 *     recipe BODIES (via CLOUD-03 `selectTouchedRecipes`) + flags.
 *   - {@link renderPublish} — output rendering, incl. the 409 → `update` hint.
 *   - {@link runPublish} — drives an injected api-client (no network in tests).
 *   - {@link publishFromFile} — the IO shell (read file, resolve home).
 * STATELESS: the returned id is printed, never persisted locally (PRD §4).
 * CLOUD-30 wires `publishFromFile` into cli.ts once the base URL/env exists.
 */
export interface PublishOptions {
  domain?: string;
  tag?: string | string[];
  visibility?: string;
  idempotencyKey?: string;
  json?: boolean;
}

export function publish(file: string, opts: PublishOptions): StubResult {
  return {
    verb: "publish",
    implementedBy: "CLOUD-25",
    parsed: {
      file,
      domain: opts.domain ?? null,
      tags: toArray(opts.tag),
      visibility: opts.visibility ?? null,
      idempotencyKey: opts.idempotencyKey ?? null,
      json: Boolean(opts.json),
    },
  };
}

/** The four page-visibility levels, validated before they hit the wire. */
const VISIBILITIES = new Set(["public", "unlisted", "private"]);

/** Coerce a raw `--visibility` flag, or `undefined` for "server default". */
export function normalizeVisibility(
  value: string | undefined,
): "public" | "unlisted" | "private" | undefined {
  if (value === undefined) return undefined;
  if (!VISIBILITIES.has(value)) {
    throw new Error(
      `invalid --visibility "${value}" (expected public | unlisted | private)`,
    );
  }
  return value as "public" | "unlisted" | "private";
}

/**
 * Assemble the publish request body. PURE (no IO): the caller supplies the HTML,
 * the home lockfile, and the candidate recipe palette; this selects ONLY the
 * touched family bodies (CLOUD-03 rule — body sha diverges from the seal) and
 * attaches their source. The whole palette is NEVER sent — the wire carries the
 * page + lockfile + just the recipes the agent edited (PRD §5.3).
 */
export async function assemblePublishPayload(input: {
  html: string;
  lockfile: Lockfile;
  candidates: readonly CandidateRecipe[];
  domain?: string | undefined;
  tags?: string[] | undefined;
  visibility?: string | undefined;
  idempotencyKey?: string | undefined;
}): Promise<PublishPayload> {
  const touched = await selectTouchedRecipes(input.candidates);
  // Carry the SOURCE of exactly the touched families, in the deterministic
  // family order `selectTouchedRecipes` already sorted by.
  const recipes: RecipePayload[] = touched.map((t) => {
    const candidate = input.candidates.find((c) => c.family === t.family)!;
    return { family: t.family, source: candidate.source };
  });
  const visibility = normalizeVisibility(input.visibility);
  return {
    html: input.html,
    lockfile: input.lockfile,
    recipes,
    ...(input.domain ? { slug: input.domain } : {}),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
    ...(visibility ? { visibility } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  };
}

/**
 * Render a publish outcome. On success prints `{ url, version }` (and `id` so
 * the agent can immediately `update` it in this same session WITHOUT persisting
 * anything to disk). `--json` emits the raw result envelope.
 */
export function renderPublishResult(
  result: PublishResult,
  json: boolean,
): string {
  if (json) return JSON.stringify(result, null, 2);
  return [
    `published ${result.url}`,
    `id:      ${result.id}`,
    `version: v${result.version}`,
  ].join("\n");
}

/**
 * Render the 409 conflict: the slug/handle is already taken. Tells the agent
 * the existing id and that it should `update` it instead of publishing anew —
 * the stateless find-before-publish loop's recovery path (PRD §4).
 */
export function renderConflict(existingId: string | undefined, json: boolean): string {
  const id = existingId ?? "(unknown)";
  if (json) {
    return JSON.stringify(
      { error: { code: "CONFLICT", existingId: existingId ?? null } },
      null,
      2,
    );
  }
  return [
    `a page with this handle already exists (id: ${id})`,
    `run: shortwind-cloud update ${id} <file>`,
  ].join("\n");
}

/** The result of a publish attempt: either rendered output, or a conflict. */
export interface PublishRun {
  /** True on a 2xx publish; false on a 409 conflict. */
  ok: boolean;
  /** The rendered, ready-to-print output. */
  output: string;
  /** The created/conflicting page id (never persisted — for the caller's flow). */
  id: string | undefined;
}

/**
 * Run `publish` against an injected api-client. Maps the 409 conflict to a
 * graceful, non-throwing {@link PublishRun} carrying the `update` hint; any
 * other ApiError propagates. STATELESS — returns the id but stores nothing.
 */
export async function runPublish(
  client: ApiClient,
  payload: PublishPayload,
  json: boolean,
): Promise<PublishRun> {
  try {
    const result = await client.publishPage(payload);
    return { ok: true, output: renderPublishResult(result, json), id: result.id };
  } catch (err) {
    if (err instanceof ApiError && err.kind === "conflict") {
      return {
        ok: false,
        output: renderConflict(err.existingId, json),
        id: err.existingId,
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// IO shell — read the recipe palette + the HTML file, resolve the active home.
// Kept thin and separate from the pure assembly/render above so the network
// path is the only un-unit-tested seam.
// ---------------------------------------------------------------------------

/**
 * Read every sealed recipe file in a home's `recipes/` dir into candidate
 * recipes (family = filename without extension). A missing palette ⇒ no
 * candidates. The `.shortwind-lock.json` and dotfiles are skipped.
 */
export function readPaletteCandidates(home: ResolvedHome): CandidateRecipe[] {
  const dir = home.recipesDir;
  if (!existsSync(dir)) return [];
  const out: CandidateRecipe[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue;
    const ext = path.extname(entry.name);
    if (ext !== ".css" && ext !== ".recipe" && ext !== ".txt") continue;
    const family = path.basename(entry.name, ext);
    out.push({
      family,
      source: readFileSync(path.join(dir, entry.name), "utf8"),
    });
  }
  out.sort((a, b) => a.family.localeCompare(b.family));
  return out;
}

/**
 * The full `publish <file>` flow: resolve the active home + token (CLOUD-11),
 * read the HTML file + lockfile + palette, assemble the payload (touched bodies
 * only), and POST it. Returns the rendered output. The api-client is injected
 * so even this shell can be exercised in tests with a fake client + temp home.
 */
export async function publishFromFile(
  file: string,
  opts: PublishOptions,
  deps: {
    home?: ResolvedHome;
    client?: ApiClient;
    baseUrl?: string;
  } = {},
): Promise<PublishRun> {
  const home = deps.home ?? resolveHome();
  const account = readActiveAccount(home.root);
  if (!account) {
    throw new Error(
      "not logged in — run `shortwind-cloud login` (no active account in the Shortwind home)",
    );
  }
  const html = readFileSync(file, "utf8");
  const lockfile = readHomeLockfile(home.root);
  const candidates = readPaletteCandidates(home);
  const payload = await assemblePublishPayload({
    html,
    lockfile,
    candidates,
    domain: opts.domain,
    tags: toArray(opts.tag),
    visibility: opts.visibility,
    idempotencyKey: opts.idempotencyKey,
  });
  const client =
    deps.client ??
    createApiClient({
      baseUrl: resolveBaseUrl(deps.baseUrl),
      token: account.token.accessToken,
    });
  return runPublish(client, payload, Boolean(opts.json));
}
