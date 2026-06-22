import { readFileSync } from "node:fs";
import { type StubResult } from "./stub.js";
import {
  assemblePublishPayload,
  readPaletteCandidates,
  renderPublishResult,
} from "./publish.js";
import {
  resolveHome,
  readActiveAccount,
  readHomeLockfile,
  type ResolvedHome,
} from "../home.js";
import type { CandidateRecipe } from "../../../shared/src/fingerprint.js";
import type { Lockfile } from "../../../shared/src/lockfile-diff.js";
import {
  createApiClient,
  resolveBaseUrl,
  type ApiClient,
  type PublishResult,
  type UpdatePayload,
} from "../api-client.js";

/**
 * `update <id> <file>` — PATCH /v1/pages/{id}: republish HTML to the same URL,
 * bumping the version (previous versions retained). This is what makes
 * "persistent" real (PRD §4).
 *
 * {@link update} is the retained CLOUD-04 parse stub (cli.test.ts). The REAL
 * behavior reuses publish's assembly ({@link assemblePublishPayload}) minus the
 * `slug` (the URL is fixed to the target id; PRD §5.6), then PATCHes the id.
 * Same stateless contract: the id comes from the caller (typically a prior
 * `find`), never from local storage. CLOUD-30 wires `updateFromFile` into cli.ts.
 */
export interface UpdateOptions {
  idempotencyKey?: string;
  json?: boolean;
}

export function update(id: string, file: string, opts: UpdateOptions): StubResult {
  return {
    verb: "update",
    implementedBy: "CLOUD-25",
    parsed: {
      id,
      file,
      idempotencyKey: opts.idempotencyKey ?? null,
      json: Boolean(opts.json),
    },
  };
}

/**
 * Assemble the PATCH body: identical to {@link assemblePublishPayload} but the
 * `slug` is dropped — an update keeps the page's existing URL. PURE (no IO).
 */
export async function assembleUpdatePayload(input: {
  html: string;
  lockfile: Lockfile;
  candidates: readonly CandidateRecipe[];
  tags?: string[] | undefined;
  visibility?: string | undefined;
  idempotencyKey?: string | undefined;
}): Promise<UpdatePayload> {
  const payload = await assemblePublishPayload({
    html: input.html,
    lockfile: input.lockfile,
    candidates: input.candidates,
    tags: input.tags,
    visibility: input.visibility,
    idempotencyKey: input.idempotencyKey,
  });
  // Drop `slug`: the update targets an id, the URL is immutable (PRD §5.6).
  const { slug: _slug, ...rest } = payload;
  void _slug;
  return rest;
}

/** Run `update` against an injected api-client; returns rendered output. */
export async function runUpdate(
  client: ApiClient,
  id: string,
  payload: UpdatePayload,
  json: boolean,
): Promise<{ output: string; result: PublishResult }> {
  const result = await client.updatePage(id, payload);
  return { output: renderPublishResult(result, json), result };
}

/**
 * The full `update <id> <file>` flow: resolve the active home + token, read the
 * HTML + lockfile + palette, assemble the PATCH body (touched bodies only), and
 * PATCH the given id. The api-client is injectable for tests.
 */
export async function updateFromFile(
  id: string,
  file: string,
  opts: UpdateOptions,
  deps: { home?: ResolvedHome; client?: ApiClient; baseUrl?: string } = {},
): Promise<{ output: string; result: PublishResult }> {
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
  const payload = await assembleUpdatePayload({
    html,
    lockfile,
    candidates,
    ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
  });
  const client =
    deps.client ??
    createApiClient({
      baseUrl: resolveBaseUrl(deps.baseUrl),
      token: account.token.accessToken,
    });
  return runUpdate(client, id, payload, Boolean(opts.json));
}
