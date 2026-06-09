export type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E };

export type Diagnostic = {
  code: string;
  message: string;
  file: string;
  line: number;
  column?: number;
};

export type RecipeFileHeader = {
  family: string;
  version: string;
  sha: string;
  sourceLine: number;
};

export type Recipe = {
  name: string;
  description: string | null;
  tokens: string[];
  references: string[];
  sourceFile: string;
  sourceLine: number;
};

export type ParsedRecipeFile = {
  header: RecipeFileHeader | null;
  recipes: Recipe[];
  // Family-level selection guidance from `@guide` comment blocks. Null when
  // the file declares none. Teaches when to reach for which recipe and calls
  // out easy-to-confuse neighbours; surfaced in the generated SKILL.md.
  guidance: string | null;
};

export type Registry = {
  flattened: Record<string, string[]>;
  families: Record<string, Recipe[]>;
  // Per-family guidance keyed by family name, collected from `@guide` blocks.
  // Optional so the many `{ families, flattened }` literals across adapters
  // stay valid; absent guidance simply renders no blurb.
  guidance?: Record<string, string>;
};
