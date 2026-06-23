/**
 * Token scopes for Shortwind Cloud (PRD 7).
 *
 * Plain-data constants + a derived union type. The default device-flow token
 * carries `pages:read` and `pages:write`; `domains:bind` is a step-up grant
 * (PRD 7.2) requested explicitly and gated by human approval.
 */

export const SCOPE_PAGES_READ = "pages:read";
export const SCOPE_PAGES_WRITE = "pages:write";
export const SCOPE_DOMAINS_BIND = "domains:bind";

/** Every scope, in canonical order. */
export const SCOPES = [
  SCOPE_PAGES_READ,
  SCOPE_PAGES_WRITE,
  SCOPE_DOMAINS_BIND,
] as const;

/** Union of all valid scope strings. */
export type Scope = (typeof SCOPES)[number];

/** Scopes a freshly issued device-flow token receives by default. */
export const DEFAULT_SCOPES: readonly Scope[] = [
  SCOPE_PAGES_READ,
  SCOPE_PAGES_WRITE,
];

/** Type guard: is `value` a known scope? */
export function isScope(value: unknown): value is Scope {
  return (
    typeof value === "string" && (SCOPES as readonly string[]).includes(value)
  );
}
