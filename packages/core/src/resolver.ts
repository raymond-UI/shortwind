import type { Diagnostic, Recipe, Registry, Result } from "./types.js";

export function buildRegistry(
  recipes: readonly Recipe[],
): Result<Registry, Diagnostic[]> {
  const errors: Diagnostic[] = [];

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

  const flatten = (name: string, stack: string[]): string[] | null => {
    const cached = resolved.get(name);
    if (cached) return cached;
    if (errored.has(name)) return null;

    const cycleIdx = stack.indexOf(name);
    if (cycleIdx !== -1) {
      const cyclePath = [...stack.slice(cycleIdx), name];
      const cycleKey = [...new Set(cyclePath)].slice().sort().join(",");
      if (!reportedCycles.has(cycleKey)) {
        reportedCycles.add(cycleKey);
        const culprit = lookup.get(cyclePath[0] ?? name);
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
    const out: string[] = [];
    let failed = false;
    for (const token of recipe.tokens) {
      if (token.startsWith("@")) {
        const refName = token.slice(1);
        if (!lookup.has(refName)) {
          failed = true;
          continue;
        }
        const sub = flatten(refName, stack);
        if (sub === null) {
          failed = true;
          continue;
        }
        out.push(...sub);
      } else {
        out.push(token);
      }
    }
    stack.pop();

    if (failed) {
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

  const families: Record<string, Recipe[]> = {};
  for (const r of recipes) {
    const fam = familyOf(r.sourceFile);
    (families[fam] ??= []).push(r);
  }

  const flattened: Record<string, string[]> = {};
  for (const [name, tokens] of resolved) {
    flattened[name] = tokens;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { flattened, families } };
}

function familyOf(sourceFile: string): string {
  const base = sourceFile.split("/").pop() ?? sourceFile;
  return base.endsWith(".css") ? base.slice(0, -4) : base;
}
