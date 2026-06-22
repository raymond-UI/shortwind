/**
 * Shared stub plumbing for the Cloud CLI skeleton (CLOUD-04).
 *
 * Every verb is wired and parses its real PRD-§4 arguments today, but the
 * network/Convex body lands in a later wave. Each handler returns a plain
 * {@link StubResult} describing the parsed input plus the issue that will
 * implement it — pure data, so the parse layer is unit-testable without IO
 * (Constraint: "No network").
 */

/** The nine agent verbs from PRD §4, in canonical order. */
export const VERBS = [
  "login",
  "init-global",
  "publish",
  "update",
  "find",
  "get",
  "delete",
  "visibility",
  "bind-domain",
] as const;

export type Verb = (typeof VERBS)[number];

/**
 * What a stub handler returns: the verb, the issue that will fill it in, and
 * the parsed args/flags so later waves (and tests) can assert the shape.
 */
export interface StubResult {
  verb: Verb;
  /** The CLOUD issue that implements this verb's body. */
  implementedBy: string;
  /** Parsed positional + flag values, already normalized. */
  parsed: Record<string, unknown>;
}

/** Human-readable "not implemented" line printed to stderr. */
export function notImplementedMessage(result: StubResult): string {
  return `shortwind-cloud ${result.verb}: not implemented yet (${result.implementedBy})`;
}

/**
 * Print the not-implemented notice and the parsed input, then exit.
 *
 * Exit code 0: parsing succeeded and the command is a known, valid no-op.
 * A *failed* parse (missing required arg) is cac's job and exits non-zero.
 */
export function reportStub(result: StubResult): void {
  process.stderr.write(notImplementedMessage(result) + "\n");
  process.stderr.write("parsed: " + JSON.stringify(result.parsed) + "\n");
}

/** Normalize a cac repeatable option (`undefined | T | T[]`) into `T[]`. */
export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
