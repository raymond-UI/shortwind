import { type StubResult } from "./stub.js";

/**
 * `update <id> <file>` — PATCH /v1/pages/{id}: republish HTML to the same URL,
 * bumping the version (previous versions retained). This is what makes
 * "persistent" real (PRD §4).
 */
export interface UpdateOptions {
  idempotencyKey?: string;
  json?: boolean;
}

export function update(id: string, file: string, opts: UpdateOptions): StubResult {
  return {
    verb: "update",
    implementedBy: "CLOUD-34",
    parsed: {
      id,
      file,
      idempotencyKey: opts.idempotencyKey ?? null,
      json: Boolean(opts.json),
    },
  };
}
