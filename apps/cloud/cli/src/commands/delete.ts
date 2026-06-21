import { type StubResult } from "./stub.js";

/**
 * `delete <id>` — DELETE /v1/pages/{id}: remove a page. "Delete" means
 * tombstone, with quarantine for abuse cases (PRD §8). `--yes` skips the
 * interactive confirmation for unattended agents.
 */
export interface DeleteOptions {
  yes?: boolean;
  json?: boolean;
}

export function deletePage(id: string, opts: DeleteOptions): StubResult {
  return {
    verb: "delete",
    implementedBy: "CLOUD-34",
    parsed: {
      id,
      yes: Boolean(opts.yes),
      json: Boolean(opts.json),
    },
  };
}
