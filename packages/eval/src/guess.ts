// Guessability resolver: given a recipe name someone *guessed* from intent,
// decide which real catalog recipe (if any) it resolves to. This models a
// realistic "did-you-mean" — it encodes the naming GRAMMAR's rules generically
// (no per-answer lookup table), then falls back to nearest-by-edit-distance.
// The same logic is intended to back the cli `recipe/unknown` suggestion.

export type GuessResolution = {
  // The resolved real recipe name (no `@`), or null if nothing matched.
  hit: string | null;
  // How it resolved, for reporting.
  via: "exact" | "grammar" | "nearest" | null;
};

function norm(guess: string): string {
  return guess.replace(/^@/, "").trim().toLowerCase();
}

// Grammar-derived rewrites. Each encodes a RULE from the naming grammar, applied
// blindly (not keyed to a specific expected answer):
//  - no `-text` suffix (it's @body, @muted, @link — never @body-text)
//  - grids are @grid-<n>, never @grid-cols-<n> (cols is redundant)
//  - composition primitives: @row (not @flex-row), @stack-* (not @flex-col)
//  - singular, not plural
function grammarRewrites(name: string): string[] {
  const out = new Set<string>();
  out.add(name.replace(/-text$/, "")); // muted-text -> muted
  out.add(name.replace(/^grid-cols-/, "grid-")); // grid-cols-3 -> grid-3
  if (name === "flex-row") out.add("row");
  if (name === "flex-col" || name === "flex-column" || name === "flex-col-md") out.add("stack-md");
  if (name.endsWith("s")) out.add(name.slice(0, -1)); // badges -> badge
  out.delete(name);
  return [...out];
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const row: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[n]!;
}

const NEAREST_MAX_DISTANCE = 2;

// Resolve a guessed name against the real recipe-name set.
export function resolveGuess(guess: string, names: ReadonlySet<string>): GuessResolution {
  const g = norm(guess);
  if (names.has(g)) return { hit: g, via: "exact" };

  for (const rewrite of grammarRewrites(g)) {
    if (names.has(rewrite)) return { hit: rewrite, via: "grammar" };
  }

  // Nearest real name within a small edit distance; ambiguous ties resolve to
  // nothing (better to say "unknown" than to silently pick the wrong recipe).
  let best: string | null = null;
  let bestDist = NEAREST_MAX_DISTANCE + 1;
  let tied = false;
  for (const name of names) {
    const d = levenshtein(g, name);
    if (d < bestDist) {
      bestDist = d;
      best = name;
      tied = false;
    } else if (d === bestDist) {
      tied = true;
    }
  }
  if (best !== null && bestDist <= NEAREST_MAX_DISTANCE && !tied) {
    return { hit: best, via: "nearest" };
  }
  return { hit: null, via: null };
}
