// Recipe names live in the same `@`-prefixed namespace as Tailwind's own
// `@`-utilities. A recipe named after one shadows it during expansion, so these
// names are off-limits for recipes (in the shipped catalog and in user-authored
// families). Today the only bare-name collision is Tailwind v4's container-query
// utility `@container`; keep this list tight and add to it only for real
// collisions.
export const RESERVED_RECIPE_NAMES: ReadonlySet<string> = new Set(["container"]);

export function isReservedRecipeName(name: string): boolean {
  return RESERVED_RECIPE_NAMES.has(name);
}
