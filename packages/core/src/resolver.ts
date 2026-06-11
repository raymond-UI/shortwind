import { isProtoPollutionKey } from "./reserved.js";
import type { Diagnostic, Recipe, Registry, Result } from "./types.js";

// A single recipe expanding past this many tokens is treated as hostile input,
// not a real catalog: a doubling reference chain (`a1 { @a0 @a0 }` …) amplifies
// exponentially, and without a cap the flattened array exhausts memory (or, via
// spread-push, overflows the engine argument limit). Real recipes are dozens of
// tokens; 10k is far above any legitimate expansion.
const MAX_FLATTENED_TOKENS = 10_000;

// Reference nesting past this depth is likewise hostile (a non-branching chain
// of thousands of recipes), and the recursive flattener would otherwise blow the
// call stack before any token cap is reached.
const MAX_REFERENCE_DEPTH = 1_000;

export type BuildRegistryOptions = {
  // Family-level guidance keyed by family name. Callers that parsed `@guide`
  // blocks pass them here; the resolver only forwards non-empty maps onto the
  // Registry so SKILL.md can render selection guidance per family.
  guidance?: Record<string, string>;
};

export function buildRegistry(
  recipes: readonly Recipe[],
  options: BuildRegistryOptions = {},
): Result<Registry, Diagnostic[]> {
  const errors: Diagnostic[] = [];

  // Reject names that collide with `Object.prototype` members before they reach
  // any property write/lookup. The registry containers below are null-prototype
  // too, but rejecting the name gives the author a diagnostic instead of a
  // vanished recipe.
  const reportedReservedFamilies = new Set<string>();
  for (const r of recipes) {
    if (isProtoPollutionKey(r.name)) {
      errors.push({
        code: "resolve/reserved-name",
        message: `recipe name '${r.name}' is reserved (collides with a JavaScript object prototype member)`,
        file: r.sourceFile,
        line: r.sourceLine,
      });
    }
    const fam = familyOf(r.sourceFile);
    if (isProtoPollutionKey(fam) && !reportedReservedFamilies.has(fam)) {
      reportedReservedFamilies.add(fam);
      errors.push({
        code: "resolve/reserved-name",
        message: `family name '${fam}' is reserved (collides with a JavaScript object prototype member)`,
        file: r.sourceFile,
        line: r.sourceLine,
      });
    }
    // Recipes are a trust boundary (`shortwind add <third-party-family>`). A
    // token containing a double-quote can break out of a `class="…"` attribute
    // or the `@source inline("…")` directive it's later interpolated into —
    // `a"onload="alert(1)` becomes a second HTML attribute. Reject it here so
    // no downstream sink has to defend against it. Single-quote arbitrary
    // values (`content-['→']`) are legitimate and handled at emission instead.
    for (const token of r.tokens) {
      if (token.includes('"')) {
        errors.push({
          code: "resolve/unsafe-token",
          message: `recipe '${r.name}' has token ${JSON.stringify(token)} containing a double-quote, which can break out of a class attribute`,
          file: r.sourceFile,
          line: r.sourceLine,
        });
      }
    }
  }

  const lookup = new Map<string, Recipe>();
  for (const r of recipes) {
    const existing = lookup.get(r.name);
    if (existing) {
      errors.push({
        code: "resolve/duplicate-name",
        message: `recipe '${r.name}' is defined in both ${existing.sourceFile}:${existing.sourceLine} and ${r.sourceFile}:${r.sourceLine}`,
        file: r.sourceFile,
        line: r.sourceLine,
      });
    } else {
      lookup.set(r.name, r);
    }
  }

  const reportedUnknown = new Set<string>();
  for (const r of recipes) {
    for (const refName of r.references) {
      if (lookup.has(refName)) continue;
      const key = `${r.name}::${refName}`;
      if (reportedUnknown.has(key)) continue;
      reportedUnknown.add(key);
      errors.push({
        code: "resolve/unknown-reference",
        message: `recipe '${r.name}' references unknown recipe '@${refName}'`,
        file: r.sourceFile,
        line: r.sourceLine,
      });
    }
  }

  const resolved = new Map<string, string[]>();
  const errored = new Set<string>();
  const reportedCycles = new Set<string>();
  // `stackSet` mirrors `stack` so cycle detection is O(1) per node instead of
  // the O(n) `stack.indexOf` it replaces — the index is only recovered (rare)
  // when a cycle actually fires.
  const stackSet = new Set<string>();

  const flatten = (name: string, stack: string[]): string[] | null => {
    const cached = resolved.get(name);
    if (cached) return cached;
    if (errored.has(name)) return null;

    if (stack.length >= MAX_REFERENCE_DEPTH) {
      errors.push({
        code: "resolve/expansion-too-large",
        message: `recipe '${name}' nests references more than ${MAX_REFERENCE_DEPTH} deep`,
        file: lookup.get(name)?.sourceFile ?? "",
        line: lookup.get(name)?.sourceLine ?? 1,
      });
      errored.add(name);
      return null;
    }

    if (stackSet.has(name)) {
      const cycleIdx = stack.indexOf(name);
      const cyclePath = [...stack.slice(cycleIdx), name];
      const cycleKey = [...new Set(cyclePath)].slice().sort().join(",");
      if (!reportedCycles.has(cycleKey)) {
        reportedCycles.add(cycleKey);
        // cyclePath[0] is always defined: we just pushed onto it via
        // `[...stack.slice(cycleIdx), name]`, so length ≥ 1.
        const culprit = lookup.get(cyclePath[0]!);
        if (culprit) {
          errors.push({
            code: "resolve/cycle",
            message: `cycle: ${cyclePath.join(" → ")}`,
            file: culprit.sourceFile,
            line: culprit.sourceLine,
          });
        }
      }
      for (const n of cyclePath) errored.add(n);
      return null;
    }

    const recipe = lookup.get(name);
    if (!recipe) return null;

    stack.push(name);
    stackSet.add(name);
    const out: string[] = [];
    let failed = false;
    let tooLarge = false;
    // Walk the parser's `references` set in lockstep with the token list so
    // we trust a single source of truth for "is this token a ref?" rather
    // than re-deriving it from the leading `@`.
    const refSet = new Set(recipe.references);
    for (const token of recipe.tokens) {
      const refName = token.startsWith("@") ? token.slice(1) : null;
      if (refName !== null && refSet.has(refName)) {
        if (!lookup.has(refName)) {
          failed = true;
          continue;
        }
        const sub = flatten(refName, stack);
        if (sub === null) {
          failed = true;
          continue;
        }
        // Append element-by-element, never `out.push(...sub)` — a spread of a
        // large sub-expansion overflows the engine's argument limit.
        for (const t of sub) out.push(t);
      } else {
        out.push(token);
      }
      if (out.length > MAX_FLATTENED_TOKENS) {
        errors.push({
          code: "resolve/expansion-too-large",
          message: `recipe '${name}' expands to more than ${MAX_FLATTENED_TOKENS} tokens`,
          file: recipe.sourceFile,
          line: recipe.sourceLine,
        });
        tooLarge = true;
        break;
      }
    }
    stack.pop();
    stackSet.delete(name);

    if (failed || tooLarge) {
      errored.add(name);
      return null;
    }
    resolved.set(name, out);
    return out;
  };

  for (const r of recipes) {
    if (resolved.has(r.name) || errored.has(r.name)) continue;
    flatten(r.name, []);
  }

  // Null-prototype containers: a recipe or family named after an inherited
  // object member (`__proto__`, `constructor`) writes/reads an own property
  // instead of mutating the prototype, so the registry stays plain serializable
  // data. Proto-key names are also rejected above, but this keeps the structure
  // sound even for registries assembled by other means.
  const families: Record<string, Recipe[]> = Object.create(null);
  for (const r of recipes) {
    const fam = familyOf(r.sourceFile);
    (families[fam] ??= []).push(r);
  }

  const flattened: Record<string, string[]> = Object.create(null);
  for (const [name, tokens] of resolved) {
    flattened[name] = tokens;
  }

  if (errors.length > 0) return { ok: false, errors };

  // Only surface guidance for families that actually resolved, and drop empty
  // strings so consumers can treat presence as "has guidance".
  const guidance: Record<string, string> = Object.create(null);
  for (const [fam, text] of Object.entries(options.guidance ?? {})) {
    if (families[fam] && text.trim().length > 0) guidance[fam] = text;
  }

  const registry: Registry = { flattened, families };
  if (Object.keys(guidance).length > 0) registry.guidance = guidance;
  return { ok: true, value: registry };
}

function familyOf(sourceFile: string): string {
  const base = sourceFile.split(/[\\/]/).pop() ?? sourceFile;
  return base.endsWith(".css") ? base.slice(0, -4) : base;
}
