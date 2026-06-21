import { type StubResult } from "./stub.js";

/** The three visibility levels (PRD §4: `visibility`). */
export const VISIBILITY_LEVELS = ["public", "unlisted", "private"] as const;
export type VisibilityLevel = (typeof VISIBILITY_LEVELS)[number];

export function isVisibilityLevel(value: string): value is VisibilityLevel {
  return (VISIBILITY_LEVELS as readonly string[]).includes(value);
}

/**
 * `visibility <id> <level>` — PATCH /v1/pages/{id}/visibility: set
 * public / unlisted / private (PRD §4).
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
