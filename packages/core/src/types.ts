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
};

export type Registry = {
  flattened: Record<string, string[]>;
  families: Record<string, Recipe[]>;
};
