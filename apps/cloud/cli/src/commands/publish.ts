import { toArray, type StubResult } from "./stub.js";

/**
 * `publish <file>` — POST /v1/pages: create a page from an HTML file
 * (+ lockfile, + touched recipes). Idempotency-keyed (PRD §4). Returns
 * id, url, version when implemented.
 *
 * `--tag` is repeatable; `--domain` sets the desired subdomain/slug;
 * `--visibility` mirrors the `visibility` verb's levels.
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
    implementedBy: "CLOUD-34",
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
