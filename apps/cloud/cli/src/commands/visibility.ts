import { type StubResult } from "./stub.js";
import type { PageSummary, VisibilityCapableClient } from "../api-client.js";

/** The three visibility levels (PRD §4: `visibility`). */
export const VISIBILITY_LEVELS = ["public", "unlisted", "private"] as const;
export type VisibilityLevel = (typeof VISIBILITY_LEVELS)[number];

export function isVisibilityLevel(value: string): value is VisibilityLevel {
  return (VISIBILITY_LEVELS as readonly string[]).includes(value);
}

/**
 * `visibility <id> <level>` — PATCH /v1/pages/{id}/visibility: set
 * public / unlisted / private (PRD §4).
 *
 * {@link visibility} is the retained CLOUD-04 parse stub (cli.test.ts). The
 * REAL behavior is {@link runVisibility}, unit-tested against a MOCKED
 * api-client (CLOUD-34); cli.ts wires `runVisibility` into the production
 * program.
 */
export interface VisibilityOptions {
  json?: boolean;
}

export function visibility(id: string, level: string, opts: VisibilityOptions): StubResult {
  return {
    verb: "visibility",
    implementedBy: "CLOUD-34",
    parsed: {
      id,
      level,
      validLevel: isVisibilityLevel(level),
      json: Boolean(opts.json),
    },
  };
}

/** Thrown when the requested level is not one of the three known levels. */
export class InvalidVisibilityError extends Error {
  constructor(public readonly level: string) {
    super(
      `invalid visibility "${level}" — expected one of ${VISIBILITY_LEVELS.join(", ")}`,
    );
    this.name = "InvalidVisibilityError";
  }
}

/**
 * Render the visibility result. `--json` emits the updated page summary the
 * server returned verbatim (stable machine contract); human mode confirms the
 * new level on the page's URL.
 */
export function renderVisibility(page: PageSummary, json: boolean): string {
  if (json) return JSON.stringify(page, null, 2);
  return `set ${page.id} → ${page.visibility} (${page.url})`;
}

/**
 * Run `visibility` against an injected api-client: validate the level locally
 * (fail fast, no wasted request), call `setVisibility`, render the updated
 * summary. Throws {@link InvalidVisibilityError} on a bad level so cli.ts can
 * report it as a clean error line + non-zero exit.
 */
export async function runVisibility(
  client: VisibilityCapableClient,
  id: string,
  level: string,
  opts: VisibilityOptions,
): Promise<string> {
  if (!isVisibilityLevel(level)) throw new InvalidVisibilityError(level);
  const page = await client.setVisibility(id, level);
  return renderVisibility(page, Boolean(opts.json));
}
