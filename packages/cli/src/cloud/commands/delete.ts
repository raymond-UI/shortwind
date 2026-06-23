import { type StubResult } from "./stub.js";
import type { DeleteCapableClient } from "../api-client.js";

/**
 * `delete <id>` — DELETE /v1/pages/{id}: remove a page. "Delete" means
 * tombstone, with quarantine for abuse cases (PRD §8). `--yes` skips the
 * interactive confirmation for unattended agents.
 *
 * {@link deletePage} is the retained CLOUD-04 parse stub (cli.test.ts). The
 * REAL behavior is {@link runDelete}, unit-tested against a MOCKED api-client
 * (CLOUD-34); cli.ts wires `runDelete` into the production program.
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

/** The outcome of a delete run, so callers (and tests) can branch on intent. */
export interface DeleteOutcome {
  /** `true` once the page was actually deleted; `false` when the user aborted. */
  deleted: boolean;
  /** The rendered line to print (human or `--json`). */
  output: string;
}

/**
 * Ask the operator to confirm a destructive delete. Injected so tests run
 * without a TTY; the default reads a single y/N line from stdin and treats
 * anything but `y`/`yes` (case-insensitive) as "no".
 */
export type Confirm = (id: string) => Promise<boolean>;

/** Render the delete result. `--json` emits a stable `{ id, deleted }` shape. */
export function renderDelete(id: string, deleted: boolean, json: boolean): string {
  if (json) return JSON.stringify({ id, deleted }, null, 2);
  return deleted ? `deleted ${id}` : `aborted — ${id} was not deleted`;
}

/**
 * Run `delete` against an injected api-client. Confirms first (unless `--yes`),
 * then calls `deletePage`. Returns the outcome without touching the process —
 * cli.ts maps `deleted === false` to a non-zero exit.
 */
export async function runDelete(
  client: DeleteCapableClient,
  id: string,
  opts: DeleteOptions,
  confirm: Confirm,
): Promise<DeleteOutcome> {
  if (!opts.yes) {
    const ok = await confirm(id);
    if (!ok) {
      return { deleted: false, output: renderDelete(id, false, Boolean(opts.json)) };
    }
  }
  await client.deletePage(id);
  return { deleted: true, output: renderDelete(id, true, Boolean(opts.json)) };
}
