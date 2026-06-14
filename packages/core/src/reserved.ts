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

// A class token in the shape of a recipe REFERENCE — `@<name>` where the name
// looks like a recipe (lowercase, hyphenated, no variant `:` / arbitrary `[` /
// container `/sidebar`). This is what distinguishes a misspelled/unknown recipe
// (`@badeg`) from Tailwind v4's own `@`-utilities (`@container`, `@md:flex`,
// `@min-[400px]:grid`), so the unknown-recipe check never false-flags those.
// Reserved names (`@container`) are excluded — they're Tailwind's, not ours.
const RECIPE_NAME_SHAPE = /^[a-z][a-z0-9-]*$/;

export function looksLikeRecipeToken(token: string): boolean {
  if (token.charCodeAt(0) !== 64 /* @ */) return false;
  const name = token.slice(1);
  return RECIPE_NAME_SHAPE.test(name) && !isReservedRecipeName(name);
}

// Keys that are inherited members of every plain object's prototype. Used as a
// recipe or family name they either crash a plain-object write/lookup
// (`families["constructor"].push`) or silently corrupt the registry
// (`flattened["__proto__"] = …` reassigns the prototype instead of adding a
// key). Registry containers are built null-prototype so these never resolve to
// inherited members, and the resolver rejects them outright as names.
export const PROTO_POLLUTION_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export function isProtoPollutionKey(name: string): boolean {
  return PROTO_POLLUTION_KEYS.has(name);
}
